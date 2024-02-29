/** 
 * @author 0m0g1
 * @github 0m0g1
 * @description "A fileserver"
*/

//imports
const {app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, shell} = require("electron"); // creates the app
if (require('electron-squirrel-startup')) app.quit(); //stop the app from launching multiple times

const fs = require("fs"); // reading files
const os = require("os"); // getting ip addresses
const express = require("express"); // handles server routing
const path = require("path"); // handles looking at paths
const { default: axios } = require("axios"); // http request to get update status


// Constants
const serverAPI = express(); // the server app
const userDataPath = path.join(app.getPath("userData"), "configs.json"); // place to store user preferences
const configs = loadConfigs(); // get the users preferences and configurations
const networkingInterfaces = os.networkInterfaces(); // the devices network addresses

serverAPI.set("views", path.join(__dirname, "views")); // set the path of the veiws or html and ejs pages
serverAPI.set("view engine", "ejs"); // set the view engine / renderer to ejs

let isServing = false; // holds the status for whether the app is serving a directory

let mainWindow; // the main app window

const createNewWindow = () => { // function to create new window it sets the global main window variable
    mainWindow = new BrowserWindow({ // configurations for the main window
        width: 667,
        height: 500,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, "assets", "icon.png") // sets the icon
    });

    mainWindow.webContents.on("dom-ready", () => { // change theme to the users preference set in the config file
        mainWindow.webContents.send("change-theme", configs.theme);
    })

    ipcMain.on("open-directory", (event) => { // when the choose directory button on the ui is pressed it triggers this event
        dialog.showOpenDialog({ // show the dialog to select the directory to server
            properties: ["openDirectory"],
        })
        .then( async (paths) => {
            if (!paths.canceled) { // if the user has chosen a directory send the data to the ui so it can be updated
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

    ipcMain.on("port-inputed", async (event, newPort) => { // handles the user changing their prefered port for serving the directory
        if (!isPureDigits(newPort)) { // shows an error if the port contains any none digit characters
            showErrorMessage({title:"error", message: `There can be no digits in port numbers: ${newPort}`});
            return;
        }
        
        configs.port = newPort; // changes the configs port to the new port then saves it

        saveConfigs();

        showMessage({
            title: "Success",
            message: `Successfully changed port to ${configs.port}`
        });

        if (!isServing) return; // when the port is updated, if you are not serving a directory don't restart the server
        
        const path = configs["recently-opened"][0]; // reserve the current opened directory when the preffered port is changed
        
        startServer(path) // restart the server
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

    ipcMain.on("loader-removed", async () => { // checks if there is a new update available when the loader showing the logo is updated
        try { // if you are able to get the status.json file check if there is a new update and prompt
            const response = await axios.get("https://0m0g1.github.io/fileserver0/status.json");
            const jsonData = response.data;
            if (jsonData.updates.version !== configs["update-status"]["current-version"]) {
                if (configs["update-status"]["alert-count"] >= 3) {
                    if (configs["update-status"]["last-alerted-version"] !== jsonData.updates.version) {
                        configs["update-status"]["last-alerted-version"] = jsonData.updates.version;
                        configs["update-status"]["alert-count"] = 0;
                        saveConfigs();
                    }
                    return;
                }
                configs["update-status"]["alert-count"] += 1;
                saveConfigs();
                showMessage({
                    title: "update available",
                    message: `There is a new update available version ${jsonData.updates.version}`
                });
            }
        } catch (err) { // do nothing if you are unable to get the update status
            return;
        }
    })

    mainWindow.loadFile(path.join(__dirname, "views", "index.html"));
}

/**
 * Function to get the devices IP address
 * 
 * @returns {string} The devices external IP address
 */

function getIPAddress() { // function to get the devices IP address
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

/**
 * Display a popup showing information
 * 
 * @param {object} message
 * @property {string} title - The title of the notification
 * @property {string} message - The message of the notification
 */

function showMessage(message) {
    dialog.showMessageBox({
        title: message.title,
        message: message.message
    })
}

/**
 * This function is used to display a popup error messages
 * 
 * @param {object} message
 * @property {string} title - The title of the notification
 * @property {string} message - The message of the notification
 */

function showErrorMessage(message) { // The function to show any error messages
    dialog.showErrorBox(message.title, message.message)
}

function readDir(dir) { // Reads the path the user chose and checks if its a file or directory and returns every subdirectory in the dir or returns the file
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

async function startServer(dir) { // Handles serving the chosen directory
    return readDir(dir) // read the directory and get all the subdirectories
        .then((subdirectories) => {
            const port = process.env.PORT || configs.port;
            
            serverAPI.get("/", (req, res) => { // set the "/" route
                const formattedSubdirectories = subdirectories.map(subdirectory => ({
                    name: subdirectory,
                    path: subdirectory
                }));
                res.render("listing", { directory: { ip: getIPAddress(), port: port, directory: dir, subdirectories: formattedSubdirectories } });
            });
            
            if (server) { // close the server if its running before you start ru
                server.close();
            }
            
            server = serverAPI.listen(port, () => { // run the server on the users prefered port
                configs["recently-opened"].forEach((recent, i) => { // removes the directory the user chose if its in the recently opened directories it will be added to the top later 
                    if (dir === recent) {
                        configs["recently-opened"].splice(i, 1);
                    }
                })

                if (configs["recently-opened"].length === 10) { // if the recently opened directories are more than ten remove the last one
                    configs["recently-opened"].pop();
                }

                configs["recently-opened"].unshift(dir); // add the currently chosen directory to the top of the recently opened directories
                saveConfigs();
                makeMainMenu();
                isServing = true;
                // console.log(`Server is running on "http://localhost:${port}/`)
            })

            serverAPI.get("*/favicon.ico", (req, res) => { // send the favicon icon whenever it is accessed
                res.sendFile(path.join(__dirname, "assets", "favicon.ico"));
            })

            serverAPI.get("/:path(*)", (req, res) => { // serve every path that comes after "/"
                
                let requestedPath = path.join(dir, req.params.path);
                /*  
                    add the subdirectory the user wants to get to, to the root directory so you can get the full path to the directory
                    for example 
                    "C://dev" + "/projects"
                */

                fs.stat(requestedPath, async (err, stats) => { // check if the requested path is a directory or file
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

                    if (!stats.isDirectory()) { // send the file if its not a directory
                        res.sendFile(requestedPath);
                    }

                    const subSubDirectories = await readDir(requestedPath); // get all of the subdirectories and files in the subdirectory
                    
                    const subDirectoriesWithPath = subSubDirectories.map(subdirectory => ({ // adds the current sub sub directory to the subdirectory to get the list of all the files and directories in the dir
                            name: subdirectory,
                            path: path.join(req.params.path, subdirectory)
                        })
                    );
                    
                    // rendre the listing view (listing.ejs) with the current directory and subdirectories
                    res.render("listing", {directory : {ip: getIPAddress(), port: port, directory: requestedPath, subdirectories: subDirectoriesWithPath}});
                })
                
            })

            return port;
        })
        .catch((err) => { // show an error message if there is a problem opening the directory
            showErrorMessage({
                title: "Error",
                message: `There was an error reading "${dir}: ${err}`
            });
        })
}

function closeServer() { // close the server
    if (server) {
        mainWindow.webContents.send("database-closed");
        server.close();
        isServing = false;
    }
}

function loadConfigs() { // load the user's preferences (configs.json)
    if (!fs.existsSync(userDataPath)) {
        const configurations = fs.readFileSync(path.join(__dirname, "configs.json"));
        const loadedConfigs = JSON.parse(configurations);
        try {
            fs.writeFileSync(userDataPath, JSON.stringify(loadedConfigs, null, 2), "utf-8");
        } catch (error) {
            showErrorMessage({
                title: "Error",
                message: `There was an error creating configs.json: ${error}`
            });
        }
    }
    try {
        const configurations = fs.readFileSync(userDataPath);
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

function saveConfigs() { // save the user's preferences (configs.json)
    try {
        fs.writeFileSync(userDataPath, JSON.stringify(configs, null, 2), "utf-8");
    } catch (error) {
        showErrorMessage({
            title: "Error",
            message: `There was an error saving configurations to configs.json: ${error}`
        });
    }
}

function getRecentlyOpenedDirectories() { // get a list of all the recently opened directories and add them to the main menu
    const items = []; // items to add to the main menu
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

function isPureDigits(str) { // checks if the port is made of only digits
    const regex = /^\d+$/;
    return regex.test(str);
}

function setTheme(mode) { // Sets and saves the theme 
    if (mode.toLowerCase() === "system") {
        if (nativeTheme.shouldUseDarkColors) {
            mainWindow.webContents.send("change-theme", "dark");
            nativeTheme.themeSource = "dark";
        } else {
            mainWindow.webContents.send("change-theme", "light");
            nativeTheme.themeSource = "light";
        }

        if (configs.theme === mode) return; // if the mode that the user has set is the mode that the app is there is no need to save
        
        configs.theme = "system";
        saveConfigs();
        
    } else if (mode.toLowerCase() === "light") {
        mainWindow.webContents.send("change-theme", "light");
        nativeTheme.themeSource = "light";
        
        if (configs.theme === mode) return;
        configs.theme = "light";
        saveConfigs();
    } else if (mode.toLowerCase() === "dark") {
        mainWindow.webContents.send("change-theme", "dark");
        nativeTheme.themeSource = "dark";
        
        if (configs.theme === mode) return;
        configs.theme = "dark";
        saveConfigs();
    } else {
        showErrorMessage({title: "Failed", message: `There is no such mode: ${mode}`})
    }
}

function makeMainMenu() { // makes the main menu
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
                            click: () => {
                                setTheme("system");
                                showMessage({
                                    title: "Success changing theme mode",
                                    message: "Restart app to reflect changes"
                                })
                            }
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
                    click: () => { // opens the documentation in the apps github repo
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

    mainWindow.webContents.on("dom-ready", () => { // set the theme to the user's preference when the app starts
        setTheme(configs.theme);
    });

    makeMainMenu();
})


app.on("window-all-closed", () => { // close the app
    if (process.platform !== "darwin") {
        app.quit();
    }
})