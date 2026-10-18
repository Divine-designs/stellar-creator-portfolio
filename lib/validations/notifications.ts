import { z } from "zod";

/**
 * Validation schemas for notification mutation routes.
 *
 * Routes covered:
 * - `notifications/[id]/read` (POST)
 * - `notifications/read-all` (POST)
 * - `notifications` (POST)
 */

/**
 * `notifications/[id]/read` — the notification id comes from the route param.
 * Accept a non-empty string id (cuid/uuid/numeric ids are all valid here);
 * ownership is enforced in the handler against the session user.
 */
export const notificationIdSchema = z.object({
  id: z
    .string({ required_error: "Notification id is required" })
    .trim()
    .min(1, "Notification id is required"),
});

export type NotificationIdInput = z.infer<typeof notificationIdSchema>;

/**
 * `notifications/read-all` — no body is expected. Reject any unexpected
 * payload so callers cannot smuggle in a target user id.
 */
export const readAllNotificationsSchema = z.object({}).strict();

export type ReadAllNotificationsInput = z.infer<
  typeof readAllNotificationsSchema
>;

/**
 * `notifications` — creating a notification.
 */
export const createNotificationSchema = z.object({
  userId: z
    .string({ required_error: "User id is required" })
    .trim()
    .min(1, "User id is required"),
  type: z
    .string({ required_error: "Notification type is required" })
    .trim()
    .min(1, "Notification type is required"),
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer"),
  message: z
    .string({ required_error: "Message is required" })
    .trim()
    .min(1, "Message is required")
    .max(2000, "Message must be 2000 characters or fewer"),
  link: z.string().trim().url("Link must be a valid URL").optional(),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
