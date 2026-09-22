import { parseJsonBody } from "./utils/parse-body.js";
import { listUsers, getUser, createUser, updateUser, deleteUser } from "./handlers/users.js";

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {"content-type": "application/json"});
    res.end(JSON.stringify(payload));
}

export async function router(req, res) {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    const parts = pathname.split("/").filter(Boolean); // ["api", "users", ":id"?]

    try {
        // GET /api/health
        if (req.method === "GET" && pathname === "/api/health") {
            return sendJson(res, 200, {status: "ok"});
        }

        // /api/users
        if (parts[0] === "api" && parts[1] === "users") {
            const id = parts[2]; // undefined if /api/users

            if (req.method === "GET" && !id)  {
                return sendJson(res, 200, listUsers());
            }
            
            if (req.method === "GET" && id) {
                const user = getUser(id);
                
                if (!user) {
                    return sendJson(res, 404, {error: "user_not_found"});
                }

                return sendJson(res, 200, user);
            }

            if (req.method == "POST" && !id) {
                const body = await parseJsonBody(req);
                const result = createUser(body);

                if (result.error) {
                    return sendJson(res, 400, {errors: result.error});
                }

                return sendJson(res, 201, result.data);
            }

            if (req.method === "PUT" && id) {
                const body = await parseJsonBody(req);
                const result = updateUser(id, body);

                if (result.notFound) {
                    return sendJson(res, 404, {error: "user_not_found"});
                }

                if (result.error) {
                    return sendJson(res, 400, {errors: result.error});
                }

                return sendJson(res, 200, result.data);
            }

            if (req.method === "DELETE" && id) {
                const deleted = deleteUser(id);
                
                if (!deleted) {
                    return sendJson(res, 404, {error: "user_not_found"});
                }

                res.writeHead(204);
                return res.end();
            }

            
        }

        // nothing matched
        return sendJson(res, 404, {error: "not_found"});
    } catch (error) {
        
        if (error.message === "invalid_json") {
            return sendJson(res, 400, {error: "invalid_json_body"});
        }

        console.error(error);
        return sendJson(res, 500, {error: "internal_server_error"});
    }
}