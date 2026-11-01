// Presentation guards only. Go authenticates roles and checks saved authorship.
export function hasRole(session, role) {
  return session?.roles?.includes(role) || false;
}
export function independentReviewer(session, item) {
  const actor = session?.operator_id;
  const authors = [item?.created_by, ...(item?.proposal_authors || [])].filter(x => typeof x === "string" && x.length > 0);
  return Boolean(actor && authors.length && !authors.includes(actor));
}
