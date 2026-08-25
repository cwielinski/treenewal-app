import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Card, Note, SectionTitle } from "./components";

/**
 * Access settings.
 *
 * The rules live in Convex, not here: this screen only writes them. Owner
 * sees everything, manager everything except Cash, staff Jobs and Map only.
 * Cash carries payroll and receivables, so it is granted on its own and is
 * off by default.
 */

type Role = "owner" | "manager" | "staff" | "none";

const SCREENS = [
  { key: "overview", label: "Overview" },
  { key: "jobs", label: "Jobs" },
  { key: "map", label: "Map" },
  { key: "cash", label: "Cash" },
  { key: "marketing", label: "Marketing" },
] as const;

const ROLES: { key: Role; label: string; blurb: string }[] = [
  { key: "owner", label: "Owner", blurb: "sees everything." },
  { key: "manager", label: "Manager", blurb: "sees everything except Cash." },
  { key: "staff", label: "Staff", blurb: "sees Jobs and Map only." },
];

function Tick({ on }: { on: boolean }) {
  return on ? (
    <span style={{ color: "var(--tn-leaf-600)", fontWeight: 700 }}>Yes</span>
  ) : (
    <span style={{ color: "var(--tn-fg-subtle)" }}>No access</span>
  );
}

/** Self service password change. Available to everyone who can sign in. */
function PasswordCard() {
  const changePassword = useAction(api.passwords.changeMyPassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== confirm) {
      setMessage("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage("Password changed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <SectionTitle>Your password</SectionTitle>
      <Note>At least ten characters. You stay signed in on this device.</Note>
      <form
        onSubmit={submit}
        style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 180px" }}>
          <span className="tn-label">Current password</span>
          <input
            className="tn-input"
            type="password"
            value={current}
            onChange={event => setCurrent(event.target.value)}
            required
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 180px" }}>
          <span className="tn-label">New password</span>
          <input
            className="tn-input"
            type="password"
            value={next}
            onChange={event => setNext(event.target.value)}
            required
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 180px" }}>
          <span className="tn-label">Repeat new password</span>
          <input
            className="tn-input"
            type="password"
            value={confirm}
            onChange={event => setConfirm(event.target.value)}
            required
          />
        </label>
        <button className="tn-btn" type="submit" disabled={busy}>
          {busy ? "Saving" : "Change password"}
        </button>
      </form>
      {message && <Note>{message}</Note>}
    </Card>
  );
}

/** Owners can set a password for anyone who has locked themselves out. */
function OwnerPasswordCard() {
  const setPassword = useAction(api.passwords.setPasswordForUser);
  const [email, setEmail] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await setPassword({ email: email.trim(), newPassword: next });
      setNext("");
      setMessage(`Password set for ${email.trim()}. Pass it on and ask them to change it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not set the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <SectionTitle>Set someone else's password</SectionTitle>
      <Note>
        For a person who is locked out. The account has to exist already, which
        means they have signed in at least once.
      </Note>
      <form
        onSubmit={submit}
        style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
          <span className="tn-label">Email</span>
          <input
            className="tn-input"
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="name@treenewal.com"
            required
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
          <span className="tn-label">New password</span>
          <input
            className="tn-input"
            type="password"
            value={next}
            onChange={event => setNext(event.target.value)}
            required
          />
        </label>
        <button className="tn-btn" type="submit" disabled={busy}>
          {busy ? "Saving" : "Set password"}
        </button>
      </form>
      {message && <Note>{message}</Note>}
    </Card>
  );
}

export function AccessPage() {
  const me = useQuery(api.access.myAccess, {});
  const rows = useQuery(api.access.listAccess, {});
  const setAccess = useMutation(api.access.setAccess);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [cash, setCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (me === undefined) {
    return (
      <div style={{ padding: 24 }}>
        <Note>Loading access.</Note>
      </div>
    );
  }

  if (me.role !== "owner") {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <SectionTitle>Access</SectionTitle>
          <Note>Only the owner can view and change access.</Note>
        </Card>
        <PasswordCard />
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (email.trim().length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      await setAccess({
        email: email.trim(),
        name: name.trim().length > 0 ? name.trim() : undefined,
        role,
        cash,
      });
      setMessage(`${email.trim()} now has ${role} access.`);
      setEmail("");
      setName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
      <Card style={{ gap: 8 }}>
        <SectionTitle>Access</SectionTitle>
        <Note>
          Cash carries payroll and receivables, so it is granted on its own and is
          off unless it is switched on. The rules are enforced in the database, not
          only in this interface.
        </Note>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 4 }}>
          {ROLES.map(item => (
            <Note key={item.key}>
              <span style={{ fontWeight: 700, color: "var(--tn-fg)" }}>
                {item.label}
              </span>{" "}
              {item.blurb}
            </Note>
          ))}
        </div>
      </Card>

      <Card style={{ gap: 10 }}>
        <SectionTitle>People</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--tn-fg-muted)" }}>
              <th style={{ fontWeight: 600, padding: "4px 0" }}>Person</th>
              <th style={{ fontWeight: 600, paddingLeft: 14 }}>Role</th>
              {SCREENS.map(screen => (
                <th
                  key={screen.key}
                  className={screen.key === "jobs" || screen.key === "cash" ? undefined : "tn-col-wide"}
                  style={{ fontWeight: 600, textAlign: "right", paddingLeft: 14 }}
                >
                  {screen.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map(row => (
              <tr key={row._id} style={{ borderTop: "1px solid var(--tn-border)" }}>
                <td style={{ padding: "8px 0" }}>
                  <div style={{ fontWeight: 600 }}>{row.name ?? row.email}</div>
                  <div style={{ fontSize: 12, color: "var(--tn-fg-subtle)" }}>
                    {row.email}
                  </div>
                </td>
                <td style={{ paddingLeft: 14, textTransform: "capitalize" }}>
                  {row.role}
                </td>
                {SCREENS.map(screen => (
                  <td
                    key={screen.key}
                    className={screen.key === "jobs" || screen.key === "cash" ? undefined : "tn-col-wide"}
                    style={{ textAlign: "right", paddingLeft: 14 }}
                  >
                    <Tick on={row.screens[screen.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {(rows ?? []).length === 0 && <Note>No one has been granted access yet.</Note>}
      </Card>

      <Card style={{ gap: 12 }}>
        <SectionTitle>Invite or update someone</SectionTitle>
        <Note>
          The person signs in with this email address and sets their own password.
        </Note>
        <form
          onSubmit={submit}
          style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
            <span className="tn-label">Email</span>
            <input
              className="tn-input"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="name@treenewal.com"
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 180px" }}>
            <span className="tn-label">Name</span>
            <input
              className="tn-input"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 1 160px" }}>
            <span className="tn-label">Role</span>
            <select
              className="tn-select"
              value={role}
              onChange={event => setRole(event.target.value as Role)}
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
              <option value="none">No access</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12 }}>
            <input
              type="checkbox"
              checked={cash}
              onChange={event => setCash(event.target.checked)}
            />
            <span style={{ fontSize: 14 }}>Grant Cash</span>
          </label>
          <button className="tn-btn" type="submit" disabled={busy}>
            {busy ? "Saving" : "Save access"}
          </button>
        </form>
        {message && <Note>{message}</Note>}
      </Card>

      <PasswordCard />
      <OwnerPasswordCard />
    </div>
  );
}
