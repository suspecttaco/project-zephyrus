console.log("start");

setTimeout(() => console.log("async timeout"), 0);

const fin = Date.now() + 200;

while (Date.now() < fin) {
    // Bloqueo de hilo intencional
}

console.log("end")