const fs = require("fs");
const os = require("os");
const express = require("express");
const path = require("path");
const {app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, shell} = require("electron");

const serverAPI = express();
serverAPI.set("view engine", "ejs");
const networkingInterfaces = os.networkInterfaces();

let mainWindow;

const createNewWindow = () => {
    mainWindow = new BrowserWindow({
        width: 667,
        height: 500,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, "assets", "icon.png")
    });

    mainWindow.webContents.on("dom-ready", () => {
        mainWindow.webContents.send("change-theme", configs.theme);
    })

    ipcMain.on("open-directory", (event) => {
        dialog.showOpenDialog({
            properties: ["openDirectory"],
        })
        .then( async (paths) => {
            if (!paths.canceled) {
                const path = paths.filePaths[0];
                const port = await startSever(path);
                const IP = getIPAddress();

                event.sender.send("opened-directory", {port:port, path: path, ip: IP});
            }
        })
        .catch((err) => {
            console.error(`There was an error opening the file dialogue: ${err}`);
        })
    })

    mainWindow.loadFile(path.join(__dirname, "views", "index.html"));
}

function getIPAddress() {
    for (const interfaceName in networkingInterfaces) {
        const interfaceAddress = networkingInterfaces[interfaceName].find((address) => {
            return !address.internal && address.family === "IPv4";
        })
        if (interfaceAddress) {
            return interfaceAddress.address;
        }
    }
    return null;
}

function readDir(dir) {
    return new Promise((resolve, reject) => {
        fs.readdir(dir, (err, directories) => {
            if (err) {
                reject(err);
            }
            resolve(directories)
        })
    })
}

let server;

async function startSever(dir) {
    return readDir(dir)
        .then((subdirectories) => {
            const port = process.env.PORT || 8080;
            
            serverAPI.get("/", (req, res) => {
                const formattedSubdirectories = subdirectories.map(subdirectory => ({
                    name: subdirectory,
                    path: subdirectory
                }));
                res.render("listing", { directory: { ip: getIPAddress(), port: port, directory: dir, subdirectories: formattedSubdirectories } });
            });
            
            if (server) {
                server.close();
            }
            
            server = serverAPI.listen(port, () => {
                const index = configs["recently-opened"].indexOf(dir);

                if (configs["recently-opened"].length == 10) {
                    configs["recently-opened"].pop();
                }

                if (index !== -1) {
                    configs["recently-opened"].pop(index);
                }
                configs["recently-opened"].unshift(dir);
                saveConfigs(configs);
                console.log(`Server is running on "http://localhost:${port}/`)
            })

            serverAPI.get("/:path(*)", (req, res) => {
                console.log(`accessed:${req.params.path}`)
                const requestedPath = path.join(dir, req.params.path);
                fs.stat(requestedPath, async (err, stats) => {
                    if (err) {
                        console.error(`Error checking the stats of ${requestedPath}: ${err}`);
                        res.status(500).send(`
                                                Internal Server Error </br>
                                                Error checking the stats of ${requestedPath}: ${err}
                                            `);
                        return;
                    }

                    if (!stats.isDirectory()) {
                        res.sendFile(requestedPath);
                    }

                    const subSubDirectories = await readDir(requestedPath);
                    
                    const subDirectoriesWithPath = subSubDirectories.map(subdirectory => ({
                            name: subdirectory,
                            path: path.join(req.params.path, subdirectory)
                        })
                    );

                    res.render("listing", {directory : {ip: getIPAddress(), port: port, directory: requestedPath, subdirectories: subDirectoriesWithPath}});
                })
                
            })

            return port;
        })
        .catch((err) => {
            console.error(`There was an error reading "${dir}: ${err}`);
        })
}

function closeServer() {
    if (server) {
        mainWindow.webContents.send("database-closed");
        server.close();
    }
}

function loadConfigs() {
    try {
        const configurations = fs.readFileSync("configs.json");
        return JSON.parse(configurations);
    } catch (error) {
        console.error(`There was an error opening configs.json; ${error}`);
    }
}

function saveConfigs(configs) {
    try {
        fs.writeFileSync("configs.json", JSON.stringify(configs, null, 4), "utf-8");
        console.log("Configurations saved successfully");
    } catch (error) {
        console.error(`There was an error saving configurations to configs.json: ${error}`);
    }
}

const configs = loadConfigs();

function getRecentlyOpenedDirectories() {
    const items = [];
    configs["recently-opened"].forEach((path) => {
        items.push({
            label: path,
            click: () => {
                startSever(path);
                mainWindow.webContents.send("opened-directory", {port:port, path: path, ip: getIPAddress()})
            }
        })
    })
    return items;
}


app.on("ready", () => {
    createNewWindow();

    nativeTheme.themeSource = configs.theme;
    mainWindow.webContents.send("change-theme", configs.theme);

    const template = [
        {
            label: "Server",
            submenu: [
                {
                    label: "Open Recent",
                    submenu: getRecentlyOpenedDirectories()
                },
                {
                    label: "Close",
                    accelerator: "CmdOrCtrl+X",
                    click: () => {
                        closeServer();
                        mainWindow.webContents.send("server-closed");
                    }
                }
            ] 
        },
        {
            label: "Theme",
            submenu: [
                {
                    label: "Light Mode",
                    click: () => {
                        mainWindow.webContents.send("change-theme", "light");
                        nativeTheme.themeSource = "light";
                        configs.theme = "light";
                        saveConfigs(configs);
                    }
                },
                {
                    label: "Dark Mode",
                    click: () => {
                        mainWindow.webContents.send("change-theme", "dark");
                        nativeTheme.themeSource = "dark";
                        configs.theme = "dark";
                        saveConfigs(configs);
                    }
                }
            ]
        },
        {
            label: "Help",
            submenu: [
                {
                    label: "About",
                    click: () => {
                        shell.openExternal("https://github.com/0m0g1/fileserver");
                    }
                }
            ]
        },
        {
            label: "Exit",
            click: () => {
                closeServer();
                app.quit();
            }
        }
    ]
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
})


app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
})