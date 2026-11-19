// @ts-check
/**
 * Notification event registry.
 *
 * Data-driven list of every event that can generate a notification, what
 * hook fires it, who the recipients are, and which category it belongs to.
 * The settings page renders these grouped by category, and the generic
 * scheduler (ScheduleEventNotifications.mjs) dispatches them.
 *
 * The canonical list of event keys lives in the shared
 * @overleaf/notification-preferences library (GLOBAL_EVENT_KEYS) so the web
 * module and the chat service agree; this registry adds the metadata the
 * web UI + scheduler need.
 *
 * recipientType:
 *   - "project-members"             every project member (owner + collab +
 *                                   read-only + token members)
 *   - "project-members-minus-actor" every member except the actor
 *   - "specific-user"               the target user (targetUserId required)
 *
 * category: "project" | "collaboration" | "security"
 */

/** @typedef {'project'|'collaboration'|'security'} EventCategory */
/** @typedef {'project-members'|'project-members-minus-actor'|'specific-user'} RecipientType */

/**
 * @typedef {Object} EventDef
 * @property {string} key
 * @property {string} labelKey i18n key for the label
 * @property {string} descKey i18n key for the description
 * @property {EventCategory} category
 * @property {string|null} hook the hook that fires this event (informational;
 *   registration lives in index.mjs)
 * @property {RecipientType} recipientType
 */

/** @type {Record<string, EventDef>} */
export const EVENTS = {
  // ── project ─────────────────────────────────────────────────────────
  projectChanges: {
    key: 'projectChanges',
    labelKey: 'notification_event_project_changes',
    descKey: 'notification_event_project_changes_description',
    category: 'project',
    hook: 'projectModified',
    recipientType: 'project-members-minus-actor',
  },
  comments: {
    key: 'comments',
    labelKey: 'notification_event_comments',
    descKey: 'notification_event_comments_description',
    category: 'project',
    hook: 'chatMessageSent',
    recipientType: 'project-members-minus-actor',
  },
  projectExpiring: {
    key: 'projectExpiring',
    labelKey: 'notification_event_projectExpiring',
    descKey: 'notification_event_projectExpiring_description',
    category: 'project',
    hook: 'projectExpired',
    recipientType: 'project-members',
  },
  projectArchived: {
    key: 'projectArchived',
    labelKey: 'notification_event_projectArchived',
    descKey: 'notification_event_projectArchived_description',
    category: 'project',
    hook: 'deactivateProject',
    recipientType: 'project-members',
  },
  projectDuplicated: {
    key: 'projectDuplicated',
    labelKey: 'notification_event_projectDuplicated',
    descKey: 'notification_event_projectDuplicated_description',
    category: 'project',
    hook: 'preDuplicateProject',
    recipientType: 'project-members-minus-actor',
  },
  projectRestored: {
    key: 'projectRestored',
    labelKey: 'notification_event_projectRestored',
    descKey: 'notification_event_projectRestored_description',
    category: 'project',
    hook: 'projectRestored',
    recipientType: 'project-members',
  },
  projectRenamed: {
    key: 'projectRenamed',
    labelKey: 'notification_event_projectRenamed',
    descKey: 'notification_event_projectRenamed_description',
    category: 'project',
    hook: 'projectRenamed',
    recipientType: 'project-members-minus-actor',
  },
  projectDeleted: {
    key: 'projectDeleted',
    labelKey: 'notification_event_projectDeleted',
    descKey: 'notification_event_projectDeleted_description',
    category: 'project',
    hook: 'projectDeleted',
    recipientType: 'project-members',
  },

  // ── collaboration ───────────────────────────────────────────────────
  memberAdded: {
    key: 'memberAdded',
    labelKey: 'notification_event_memberAdded',
    descKey: 'notification_event_memberAdded_description',
    category: 'collaboration',
    hook: 'memberAdded',
    recipientType: 'specific-user',
  },
  memberRemoved: {
    key: 'memberRemoved',
    labelKey: 'notification_event_memberRemoved',
    descKey: 'notification_event_memberRemoved_description',
    category: 'collaboration',
    hook: 'memberRemoved',
    recipientType: 'specific-user',
  },
  permissionsChanged: {
    key: 'permissionsChanged',
    labelKey: 'notification_event_permissionsChanged',
    descKey: 'notification_event_permissionsChanged_description',
    category: 'collaboration',
    hook: 'permissionsChanged',
    recipientType: 'specific-user',
  },
  trackChangesToggled: {
    key: 'trackChangesToggled',
    labelKey: 'notification_event_trackChangesToggled',
    descKey: 'notification_event_trackChangesToggled_description',
    category: 'collaboration',
    hook: 'trackChangesToggled',
    recipientType: 'project-members',
  },

  // ── security / account ──────────────────────────────────────────────
  emailChanged: {
    key: 'emailChanged',
    labelKey: 'notification_event_emailChanged',
    descKey: 'notification_event_emailChanged_description',
    category: 'security',
    hook: 'userEmailChanged',
    recipientType: 'specific-user',
  },
  passwordChanged: {
    key: 'passwordChanged',
    labelKey: 'notification_event_passwordChanged',
    descKey: 'notification_event_passwordChanged_description',
    category: 'security',
    hook: 'passwordChanged',
    recipientType: 'specific-user',
  },
  newLogin: {
    key: 'newLogin',
    labelKey: 'notification_event_newLogin',
    descKey: 'notification_event_newLogin_description',
    category: 'security',
    hook: 'userLoggedIn',
    recipientType: 'specific-user',
  },
}

export const EVENT_CATEGORIES = ['project', 'collaboration', 'security']

/**
 * All event keys (stable order for normalization + UI).
 * @returns {string[]}
 */
export function allEventKeys() {
  return Object.keys(EVENTS)
}

/**
 * @param {string} key
 * @returns {EventDef|undefined}
 */
export function getEvent(key) {
  return EVENTS[key]
}

/**
 * @param {EventCategory} category
 * @returns {EventDef[]}
 */
export function eventsInCategory(category) {
  return Object.values(EVENTS).filter(e => e.category === category)
}
