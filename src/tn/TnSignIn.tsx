import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Link } from "react-router";
import { AuthError, AuthField, AuthShell } from "./AuthShell";

function isTestEmail(email: string): boolean {
  return email.endsWith("@test.local");
}

type Step =
  | "signIn"
  | { type: "forgot"; email?: string }
  | { type: "reset-code"; email: string }
  | { type: "new-password"; email: string; code: string };

export function TnSignIn() {
  const { signIn } = useAuthActions();
  const [step, setStep] = useState<Step>("signIn");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (step === "signIn") {
    return (
      <AuthShell>
        <form
          className="tn-auth-form"
          onSubmit={async e => {
            e.preventDefault();
            setError("");
            setLoading(true);
            const formData = new FormData(e.currentTarget);
            const email = formData.get("email") as string;
            const provider = isTestEmail(email) ? "test" : "password";
            try {
              await signIn(provider, formData);
            } catch {
              setError("That email and password do not match an account.");
            } finally {
              setLoading(false);
            }
          }}
        >
          <AuthField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <AuthField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <input name="flow" value="signIn" type="hidden" />
          <AuthError message={error} />
          <button className="tn-btn tn-btn-block" type="submit" disabled={loading}>
            {loading ? "Signing in" : "Sign in"}
          </button>
          <button
            className="tn-auth-link"
            type="button"
            onClick={() => setStep({ type: "forgot" })}
          >
            Forgot your password?
          </button>
          <Link className="tn-auth-link" to="/signup">
            First time here, set your password
          </Link>
        </form>
      </AuthShell>
    );
  }

  if (step.type === "forgot") {
    return (
      <AuthShell>
        <form
          className="tn-auth-form"
          onSubmit={async e => {
            e.preventDefault();
            setError("");
            setLoading(true);
            const formData = new FormData(e.currentTarget);
            const email = formData.get("email") as string;
            try {
              await signIn("password", formData);
              setStep({ type: "reset-code", email });
            } catch {
              setError("The reset code could not be sent. Try again.");
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="tn-auth-head">Reset your password</div>
          <div className="tn-auth-sub">
            Enter your email and a reset code will be sent to it.
          </div>
          <AuthField
            label="Email"
            name="email"
            type="email"
            defaultValue={step.email}
            autoComplete="email"
            required
          />
          <input name="flow" value="reset" type="hidden" />
          <AuthError message={error} />
          <button className="tn-btn tn-btn-block" type="submit" disabled={loading}>
            {loading ? "Sending" : "Send reset code"}
          </button>
          <button
            className="tn-auth-link"
            type="button"
            onClick={() => setStep("signIn")}
          >
            Back to sign in
          </button>
        </form>
      </AuthShell>
    );
  }

  if (step.type === "reset-code") {
    return (
      <AuthShell>
        <form
          className="tn-auth-form"
          onSubmit={e => {
            e.preventDefault();
            setError("");
            const formData = new FormData(e.currentTarget);
            const code = formData.get("code") as string;
            setStep({ type: "new-password", email: step.email, code });
          }}
        >
          <div className="tn-auth-head">Check your email</div>
          <div className="tn-auth-sub">A code was sent to {step.email}.</div>
          <AuthField label="Reset code" name="code" type="text" required />
          <AuthError message={error} />
          <button className="tn-btn tn-btn-block" type="submit">
            Continue
          </button>
          <button
            className="tn-auth-link"
            type="button"
            onClick={() => setStep({ type: "forgot", email: step.email })}
          >
            Send another code
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form
        className="tn-auth-form"
        onSubmit={async e => {
          e.preventDefault();
          setError("");
          setLoading(true);
          const formData = new FormData(e.currentTarget);
          try {
            await signIn("password", formData);
          } catch {
            setError("That password was not accepted. Use at least 10 characters.");
          } finally {
            setLoading(false);
          }
        }}
      >
        <div className="tn-auth-head">Choose a new password</div>
        <div className="tn-auth-sub">At least 10 characters.</div>
        <input name="email" value={step.email} type="hidden" />
        <input name="code" value={step.code} type="hidden" />
        <AuthField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        <input name="flow" value="reset-verification" type="hidden" />
        <AuthError message={error} />
        <button className="tn-btn tn-btn-block" type="submit" disabled={loading}>
          {loading ? "Saving" : "Save password"}
        </button>
      </form>
    </AuthShell>
  );
}

export function TnSignUp() {
  const { signIn } = useAuthActions();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // The password provider is configured with email verification, so signing
  // up sends a six digit code and does not create a session on its own. The
  // code step below is what completes the account.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  if (pendingEmail) {
    return (
      <AuthShell footnote="The code expires shortly. If it does not arrive, check the spam folder.">
        <form
          className="tn-auth-form"
          onSubmit={async e => {
            e.preventDefault();
            setError("");
            setLoading(true);
            const formData = new FormData(e.currentTarget);
            try {
              await signIn("password", formData);
            } catch {
              setError("That code was not accepted. Check it and try again.");
            } finally {
              setLoading(false);
            }
          }}
        >
          <div className="tn-auth-head">Check your email</div>
          <div className="tn-auth-sub">
            A six digit code was sent to {pendingEmail}. Enter it to finish
            setting up your account.
          </div>
          <AuthField
            label="Code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
          <input name="flow" value="email-verification" type="hidden" />
          <input name="email" value={pendingEmail} type="hidden" />
          <AuthError message={error} />
          <button className="tn-btn tn-btn-block" type="submit" disabled={loading}>
            {loading ? "Verifying" : "Verify and continue"}
          </button>
          <button
            className="tn-auth-link"
            type="button"
            onClick={() => {
              setError("");
              setPendingEmail(null);
            }}
          >
            Use a different email
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell footnote="Use your TreeNewal email address. Access to each screen is set by an owner after your first sign in.">
      <form
        className="tn-auth-form"
        onSubmit={async e => {
          e.preventDefault();
          setError("");
          setLoading(true);
          const formData = new FormData(e.currentTarget);
          const email = formData.get("email") as string;
          try {
            await signIn(isTestEmail(email) ? "test" : "password", formData);
            if (!isTestEmail(email)) setPendingEmail(email);
          } catch {
            setError(
              "That account could not be created. The password needs at least 10 characters, the email must be a TreeNewal address, and it may already be registered.",
            );
          } finally {
            setLoading(false);
          }
        }}
      >
        <div className="tn-auth-head">Set your password</div>
        <div className="tn-auth-sub">
          First time here. Choose the password you will sign in with.
        </div>
        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <input name="flow" value="signUp" type="hidden" />
        <AuthError message={error} />
        <button className="tn-btn tn-btn-block" type="submit" disabled={loading}>
          {loading ? "Creating" : "Create account"}
        </button>
        <Link className="tn-auth-link" to="/login">
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}
