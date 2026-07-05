import * as sheets from "./sheets";

const backend = sheets;

export default backend;

export const apiGet = backend.apiGet;
export const apiPost = backend.apiPost;
export const login = backend.login;
export const getStatus = backend.getStatus;
export const getOrders = backend.getOrders;
export const getOrder = backend.getOrder;
export const getInventory = backend.getInventory;
export const updateAdmin = backend.updateAdmin;
export const placeOrder = backend.placeOrder;
export const updateStatus = backend.updateStatus;
export const updateInventory = backend.updateInventory;
export const clearCompleted = backend.clearCompleted;
export const clearAll = backend.clearAll;
