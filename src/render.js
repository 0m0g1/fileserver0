const pathInput = document.querySelector("#path-input");
const openDialogBtn = document.querySelector("#openDirectoryDialogue")
const portDisplay = document.querySelector("#port-display");

const { dialog, ipcRenderer } = require("electron");


openDialogBtn.onclick = () => {
    ipcRenderer.send("open-directory");
    ipcRenderer.on("opened-directory", (event, data) => {
        pathInput.value = data.path;
        portDisplay.innerHTML = `http://localhost:${data.port}/folder`;
    })
}