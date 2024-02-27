const pathInput = document.querySelector("#path-input");
const openDialogBtn = document.querySelector("#openDirectoryDialogue")
const portDisplay = document.querySelector("#port-display");
const remoteDisplay = document.querySelector("#remote-display");

const { dialog, ipcRenderer } = require("electron");


openDialogBtn.onclick = () => {
    ipcRenderer.send("open-directory");
    ipcRenderer.on("opened-directory", (event, data) => {
        pathInput.value = data.path;
        portDisplay.innerHTML = `http://localhost:${data.port}/`;
        remoteDisplay.innerHTML = `http://${data.ip}:${data.port}/`;
    })
}

ipcRenderer.on("change-theme", (event, mode) => {
    const body = document.body;
    
    if (mode === "light") {
        body.classList.remove("dark");
    } else {
        body.classList.remove("light")
    }
    body.classList.add(mode);
})