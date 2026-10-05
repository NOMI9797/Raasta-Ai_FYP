// Who may look at the system status and start or stop programs: admins and people working in hiring.
export function canUseSystem(user) {
  return user?.role === "admin" || (Array.isArray(user?.modes) && user.modes.includes("recruiter"));
}
