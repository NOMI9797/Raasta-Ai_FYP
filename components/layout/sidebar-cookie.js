// Shared by the dashboard layout (server, reads it) and SidebarContext (client, writes it).
// Kept out of the "use client" module so the server can import the plain value.
export const SIDEBAR_COOKIE = "raasta_sidebar";
