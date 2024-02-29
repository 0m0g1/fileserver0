const pathInput = document.querySelector("#path-input");
const openDialogBtn = document.querySelector("#openDirectoryDialogue")
const portDisplay = document.querySelector("#port-display");
const remoteDisplay = document.querySelector("#remote-display");
const loader = document.querySelector("#loader");
const textInfos = document.querySelectorAll(".text-info");

const { dialog, ipcRenderer, shell } = require("electron");
const prompt = require("native-prompt");

setTimeout(() => {
    loader.style.display = "none";
    ipcRenderer.send("loader-removed");
}, 3200)

openDialogBtn.onclick = () => {
    ipcRenderer.send("open-directory");
}

remoteDisplay.onclick = () => {
    shell.openExternal(remoteDisplay.innerHTML);
}

ipcRenderer.on("opened-directory", (event, data) => {
    pathInput.value = data.path;
    portDisplay.innerHTML = `http://localhost:${data.port}/`;
    remoteDisplay.innerHTML = `http://${data.ip}:${data.port}/`;
})

ipcRenderer.on("change-theme", (event, mode) => {
    const body = document.body;
    
    if (mode === "light") {
        body.classList.remove("dark");
        textInfos.forEach((element) => {
            element.classList.remove("has-text-light");
            element.classList.add("has-text-dark");
        })
    } else {
        body.classList.remove("light")
        textInfos.forEach((element) => {
            element.classList.remove("has-text-dark");
            element.classList.add("has-text-light");
        })
    }

    body.classList.add(mode);
});

ipcRenderer.on("database-closed", () => {
    pathInput.value = "";
    portDisplay.innerHTML = "";
    remoteDisplay.innerHTML = "";
})

ipcRenderer.on("input-port", async (event, currentPort) => {
    const newPort = await prompt("Pick a port", "Pick a new port to expose the server from", {defaultText: currentPort});
    if (newPort) {
        ipcRenderer.send("port-inputed", newPort);
    } else {
        alert("No port was chosen");
    }
})

ipcRenderer.on("there-was-an-error", (event, error) => {
    alert(error);
});