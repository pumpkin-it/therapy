// Keep in step with server/services/clientContacts.js.
export const CONTACT_ROLES = [
  ['family', 'Family / guardian', 'indigo'],
  ['carer', 'Carer', 'teal'],
  ['support_coordinator', 'Support coordinator', 'purple'],
  ['plan_manager', 'Plan manager', 'blue'],
  ['school', 'School / teacher', 'amber'],
  ['health', 'Health professional', 'green'],
  ['other', 'Other', 'gray'],
];

export const roleLabel = role => (CONTACT_ROLES.find(r => r[0] === role) || CONTACT_ROLES[CONTACT_ROLES.length - 1])[1];
export const roleColor = role => (CONTACT_ROLES.find(r => r[0] === role) || CONTACT_ROLES[CONTACT_ROLES.length - 1])[2];
