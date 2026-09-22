import { createServer } from "http";

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
    if (req.url === "/api/health") {
        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify({status: "ok"}));
        return;        
    }

    res.writeHead(404, {"content-type": "application/json"});
    res.end(JSON.stringify({error: "not_found" }))
});


server.listen(port, () => {
    console.log(`[server] API listening on http//localhost:${port}`);
});