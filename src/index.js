const fs = require("fs");
const os = require("os");
const express = require("express");
const path = require("path");
const {app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, shell} = require("electron");

const configs =  loadConfigs();
const serverAPI = express();
serverAPI.set("views", path.join(__dirname, "views"));
serverAPI.set("view engine", "ejs");
const networkingInterfaces = os.networkInterfaces();

let isServing = false;

let mainWindow;

const createNewWindow = () => {
    mainWindow = new BrowserWindow({
        width: 667,
        height: 500,
        resizable: false,
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
                const port = await startServer(path);
                const IP = getIPAddress();

                event.sender.send("opened-directory", {port:port, path: path, ip: IP});
            }
        })
        .catch((err) => {
            showErrorMessage({
                title: "Error",
                message: `There was an error opening the file dialogue: ${err}`
            })
        })
    })

    ipcMain.on("port-inputed", async (event, newPort) => {
        if (!isPureDigits(newPort)) {
            showErrorMessage({title:"error", message: `There can be no digits in port numbers: ${newPort}`});
            return;
        }
        
        configs.port = newPort;

        saveConfigs();

        showSuccessMessage({
            title: "Success",
            message: `Successfully changed port to ${configs.port}`
        });

        if (!isServing) return;
        
        const path = configs["recently-opened"][0];
        
        startServer(path)
        .then((port) => {
            const ip = getIPAddress();
            mainWindow.webContents.send("opened-directory", {port:port, path: path, ip: ip});
        })
        .catch((err) => {
            console.error(`There was an error starting the server: ${err}`);
            showErrorMessage({
                title: "Error",
                message: `There was an error starting the server: ${err}`
            });
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

function showSuccessMessage(message) {
    dialog.showMessageBox({
        title: message.title,
        message: message.message
    })
}

function showErrorMessage(message) {
    dialog.showErrorBox(message.title, message.message)
}


function readDir(dir) {
    return new Promise((resolve, reject) => {
        fs.stat(dir, (err, status) => {
            if (err) {
                reject(err);
            
            } else {
                if (status.isDirectory()) {
                    fs.readdir(dir, (err, directories) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(directories)
                    })
                } else if (status.isFile()) {
                    fs.readFile(dir, (err, data) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(data);
                    })
                } else {
                    reject(`${dir} is neither a file nor a directory`);
                }
            }

        })
    })
}

let server;

async function startServer(dir) {
    return readDir(dir)
        .then((subdirectories) => {
            const port = process.env.PORT || configs.port;
            
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
                configs["recently-opened"].forEach((recent, i) => {
                    if (dir === recent) {
                        configs["recently-opened"].splice(i, 1);
                    }
                })

                if (configs["recently-opened"].length === 10) {
                    configs["recently-opened"].pop();
                }

                configs["recently-opened"].unshift(dir);
                saveConfigs();
                makeMainMenu();
                isServing = true;
                console.log(`Server is running on "http://localhost:${port}/`)
            })

            serverAPI.get("*/favicon.ico", (req, res) => {
                res.sendFile(path.join(__dirname, "assets", "favicon.ico"));
            })

            serverAPI.get("/:path(*)", (req, res) => {
                
                let requestedPath = path.join(dir, req.params.path);

                fs.stat(requestedPath, async (err, stats) => {
                    if (err) {
                        showErrorMessage({
                            title: "Error",
                            message: `Error checking the stats of ${requestedPath}: ${err}`
                        });
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
            showErrorMessage({
                title: "Error",
                message: `There was an error reading "${dir}: ${err}`
            });
        })
}

function closeServer() {
    if (server) {
        mainWindow.webContents.send("database-closed");
        server.close();
        isServing = false;
    }
}

function loadConfigs() {
    try {
        const configurations = fs.readFileSync(path.join(__dirname, "configs.json"));
        const loadedConfigs = JSON.parse(configurations);
        if (!loadedConfigs.hasOwnProperty("recently-opened")) {
            loadedConfigs["recently-opened"] = [];
        }
        return loadedConfigs;
    } catch (error) {
        showErrorMessage({
            title: "Error",
            message: `There was an error opening configs.json; ${error}`
        });
    }
}

function saveConfigs() {
    try {
        const configsFilePath = path.join(__dirname, "configs.json");
        fs.writeFileSync(configsFilePath, JSON.stringify(configs, null, 2), "utf-8");
    } catch (error) {
        showErrorMessage({
            title: "Error",
            message: `There was an error saving configurations to configs.json: ${error}`
        });
    }
}

function getRecentlyOpenedDirectories() {
    const items = [];
    configs["recently-opened"].forEach((path) => {
        items.push({
            label: path,
            click: async () => {
                const port = await startServer(path);
                const serializedData = {
                    port: port,
                    path: path,
                    ip: getIPAddress()
                };
                mainWindow.webContents.send("opened-directory", serializedData)
            }
        })
    })
    return items;
}

function isPureDigits(str) {
    const regex = /^\d+$/;
    return regex.test(str);
}

function setTheme(mode) {
    if (mode.toLowerCase() === "system") {
        if (nativeTheme.shouldUseDarkColors) {
            mainWindow.webContents.send("change-theme", "dark");
            nativeTheme.themeSource = "dark";
        } else {
            mainWindow.webContents.send("change-theme", "light");
            nativeTheme.themeSource = "light";
        }
        configs.theme = "system";
        saveConfigs();
    } else if (mode.toLowerCase() === "light") {
        mainWindow.webContents.send("change-theme", "light");
        nativeTheme.themeSource = "light";
        configs.theme = "light";
        saveConfigs();
    } else if (mode.toLowerCase() === "dark") {
        mainWindow.webContents.send("change-theme", "dark");
        nativeTheme.themeSource = "dark";
        configs.theme = "dark";
        saveConfigs();
    } else {
        showErrorMessage({title: "Failed", message: `There is no such mode: ${mode}`})
    }
}

function makeMainMenu() {
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
                    accelerator: "CmdOrCtrl+Q",
                    click: () => {
                        closeServer();
                        mainWindow.webContents.send("server-closed");
                    }
                }
            ] 
        },
        {
            label: "Preferences",
            submenu: [
                {
                    label: "Port",
                    click: () => {
                        mainWindow.webContents.send("input-port", configs.port);
                    }
                },
                {
                    label: "Theme",
                    submenu: [
                        {
                            label: "System",
                            click: () => {setTheme("system")}
                        },
                        {
                            label: "Light Mode",
                            accelerator: "CmdOrCtrl+L",
                            click: () => {setTheme("light")}
                        },
                        {
                            label: "Dark Mode",
                            accelerator: "CmdOrCtrl+D",
                            click: () => {setTheme("dark")}
                        }
                    ]
                }
            ]
        },
        {
            label: "Help",
            submenu: [
                {
                    label: "About",
                    accelerator: "CmdOrCtrl+A",
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
}


app.on("ready", () => {
    createNewWindow();

    mainWindow.webContents.on("dom-ready", () => {
        setTheme(configs.theme);
    });

    makeMainMenu();
})


app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
})