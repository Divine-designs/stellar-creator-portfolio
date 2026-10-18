import { z } from "zod";

/**
 * Validation schemas for the onboarding mutation route.
 *
 * The onboarding route accepts a step identifier plus the payload for that
 * step. Each step has its own shape, so we model them individually and then
 * discriminate on `step`.
 */

export const onboardingProfileStepSchema = z.object({
  step: z.literal("profile"),
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(500).optional(),
  avatarUrl: z.string().url().max(2048).optional(),
});

export const onboardingInterestsStepSchema = z.object({
  step: z.literal("interests"),
  interests: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
});

export const onboardingWalletStepSchema = z.object({
  step: z.literal("wallet"),
  walletAddress: z.string().trim().min(1).max(128),
});

export const onboardingStepSchema = z.discriminatedUnion("step", [
  onboardingProfileStepSchema,
  onboardingInterestsStepSchema,
  onboardingWalletStepSchema,
]);

export type OnboardingStepInput = z.infer<typeof onboardingStepSchema>;
