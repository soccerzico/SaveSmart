import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AuthLayout from "../components/layout/AuthLayout.jsx";
import { Alert, Button, Icon, Input } from "../components/ui";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Inline, non-blocking: the rule is stated up front and confirmed as it is
  // met, rather than failing the user after they press the button.
  const tooShort = password.length > 0 && password.length < 8;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await register(email, password);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="trending" size={17} />
          </span>
          <span className="brand-word">SaveSmart</span>
        </div>

        <div>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-sub">
            Takes a minute. You can add accounts by hand before linking a bank.
          </p>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={8}
          error={tooShort ? "At least 8 characters." : undefined}
          hint={
            password.length >= 8 ? "Long enough." : "At least 8 characters."
          }
        />

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>

        <p className="auth-foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>

        <p className="auth-legal">
          <Icon name="shield" size={14} />
          Passwords are hashed; balances stay on your own server.
        </p>
      </form>
    </AuthLayout>
  );
}
