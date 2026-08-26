import type { ReactNode } from "react";

/**
 * The sign in shell from the approved design: a photograph on the left at 640px
 * on desktop, the logo and a single card on the right. On mobile the photograph
 * becomes a 248px band across the top and the card fills the width.
 */
export function AuthShell({
  children,
  footnote = "Private company dashboard. Access is limited to authorized TreeNewal users.",
}: {
  children: ReactNode;
  footnote?: string;
}) {
  return (
    <div className="tn-app tn-auth">
      <div className="tn-auth-photo" />
      <div className="tn-auth-panel">
        <img src="/logo-full.png" alt="TreeNewal" className="tn-auth-logo" />
        <div className="tn-auth-card">{children}</div>
        <div className="tn-auth-note">{footnote}</div>
      </div>
    </div>
  );
}

export function AuthField({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="tn-auth-field">
      <label className="tn-label" htmlFor={props.id ?? props.name}>
        {label}
      </label>
      <input className="tn-input" id={props.id ?? props.name} {...props} />
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return <div className="tn-auth-error">{message}</div>;
}
