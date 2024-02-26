const express = require("express");
const path = require("path");
const {app, BrowserWindow, ipcMain, dialog} = require("electron");

const serverAPI = express();


const createNewWindow = () => {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    ipcMain.on("open-directory", (event) => {
        dialog.showOpenDialog({
            properties: ["openFile"],
        })
        .then((paths) => {
            if (!paths.canceled) {
                const path = paths.filePaths[0];
                const port = startSever(path);
                event.sender.send("opened-directory", {port:port, path: path});
            }
        })
        .catch((err) => {
            console.error(`There was an error opening the file dialogue: ${err}`);
        })
    })

    mainWindow.loadFile(path.join(__dirname, "pages", "index.html"));
}

function startSever(dir) {
    serverAPI.use("/folder/", express.static(path.join(__dirname, "styles")));
    // serverAPI.use("/folder/", express.static(dir));
    const port = process.env.PORT || 8080;
    
    serverAPI.listen(port, () => {
        console.log(`App is running on "http://localhost:${port}/folder`)
    })

    return port;
}

app.on("ready", () => {
    createNewWindow();
})


app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
})