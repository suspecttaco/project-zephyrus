const users = [];
let nextId = 1;

function validateUser(data) {
    const errors = [];

    if (!data || typeof data !== "object") {
        errors.push("body must be a JSON object");
        return errors;
    }

    if (!data.email || typeof data.email !== "string") {
        errors.push("email is required");
    }

    if (!data.name || typeof data.name !== "string") {
        errors.push("name is required");
    }

    return errors;
}

export function listUsers() {
    return users;
}

export function getUser(id) {
    return users.find((u) => u.id === id);
}

export function createUser(data) {
    const errors = validateUser(data);

    if (errors.length > 0) {
        return { error: errors};
    }

    const user = {
        id: String(nextId++),
        email: data.email,
        name: data.name,
        createdAt: new Date().toISOString(),
    };

    users.push(user);
    return { data: user };
}

export function updateUser(id, data) {
    const user = getUser(id);
    if (!user) return { notFound: true };

    const errors = validateUser({ ...user, ...data });
    if (errors.length > 0) {
        return { error: errors };
    }

    Object.assign(user, data);
    return { data: user };
}

export function deleteUser(id) {
    const index = users.findIndex((u) => u.id === id);

    if (index === -1) {
        return false;
    }

    users.splice(index, 1);
    return true;
}