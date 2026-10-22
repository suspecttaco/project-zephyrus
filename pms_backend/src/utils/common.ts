import bcrypt from "bcrypt";

export const encryptString = async (plainText: string): Promise<string> => {
    const saltRounds = 8;
    return await bcrypt.hash(plainText, saltRounds);
};

export const bcryptCompare = async (plainText: string, hash: string): Promise<boolean> => {
    return await bcrypt.compare(plainText, hash);
};

export const SERVER_CONST = {
    JWTSECRET: process.env.JWT_SECRET || 'ClaveSecretaPMS_UAS_2026',
    ACCESS_TOKEN_EXPIRY_TIME_SECONDS: 8 * 60 * 60,
    REFRESH_TOKEN_EXPIRY_TIME_SECONDS: 7 * 24 * 60 * 60
};

export const Rights = {
    ROLES: {
        ALL: 'add_role,edit_role,get_all_roles,get_details_role,delete_role',
        ADD: 'add_role',
        EDIT: 'edit_role',
        GET_ALL: 'get_all_roles',
        GET_DETAILS: 'get_details_role',
        DELETE: 'delete_role'
    },
    USERS: {
        ALL: 'add_user,edit_user,get_all_users,get_details_user,delete_user',
        ADD: 'add_user',
        EDIT: 'edit_user',
        GET_ALL: 'get_all_users',
        GET_DETAILS: 'get_details_user',
        DELETE: 'delete_user'
    },
    PROJECTS: {
        ALL: 'add_project,edit_project,get_all_projects,get_details_project,delete_project',
        ADD: 'add_project',
        EDIT: 'edit_project',
        GET_ALL: 'get_all_projects',
        GET_DETAILS: 'get_details_project',
        DELETE: 'delete_project'
    },
    TASKS: {
        ALL: 'add_task,edit_task,get_all_tasks,get_details_task,delete_task',
        ADD: 'add_task',
        EDIT: 'edit_task',
        GET_ALL: 'get_all_tasks',
        GET_DETAILS: 'get_details_task',
        DELETE: 'delete_task'
    },
    AUDIT: {
        ALL: 'get_audit_events',
        GET_ALL: 'get_audit_events'
    },
    COMMENTS: {
        ALL: 'add_comment,edit_comment,get_all_comments,get_details_comment,delete_comment',
        ADD: 'add_comment',
        EDIT: 'edit_comment',
        GET_ALL: 'get_all_comments',
        GET_DETAILS: 'get_details_comment',
        DELETE: 'delete_comment'
    }
};

