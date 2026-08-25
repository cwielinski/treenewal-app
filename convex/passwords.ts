import { v } from "convex/values";
import { modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * Password self service.
 *
 * Anyone signed in can change their own password by proving the current one.
 * An owner can set a new password for anyone, which is how a person who has
 * lost their password gets back in without waiting on anybody outside the
 * business.
 */

const MIN_LENGTH = 10;

function checkNewPassword(password: string) {
  if (password.trim().length < MIN_LENGTH) {
    throw new Error(`Choose a password of at least ${MIN_LENGTH} characters.`);
  }
}

export const changeMyPassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, { currentPassword, newPassword }) => {
    checkNewPassword(newPassword);
    const email: string = await ctx.runQuery(api.access.myEmail, {});
    if (!email) throw new Error("Sign in again and retry.");

    // Throws when the current password does not match, so a stolen session
    // alone cannot change the password.
    await retrieveAccount(ctx, {
      provider: "password",
      account: { id: email, secret: currentPassword },
    });

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: newPassword },
    });
    return null;
  },
});

export const setPasswordForUser = action({
  args: { email: v.string(), newPassword: v.string() },
  returns: v.null(),
  handler: async (ctx, { email, newPassword }) => {
    checkNewPassword(newPassword);
    // The query does the owner check, so this action cannot be called by
    // anyone else even though it is public.
    const target: string = await ctx.runQuery(api.access.emailForReset, { email });
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: target, secret: newPassword },
    });
    return null;
  },
});
