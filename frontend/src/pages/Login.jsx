import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AuthLayout from "../components/layout/AuthLayout.jsx";
import { Alert, Button, Icon, Input } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
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
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-sub">Sign in to pick up where you left off.</p>
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
          autoComplete="current-password"
        />

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>

        <p className="auth-foot">
          No account? <Link to="/register">Create one</Link>
        </p>

        <p className="auth-legal">
          <Icon name="shield" size={14} />
          Passwords are hashed; balances stay on your own server.
        </p>
      </form>
    </AuthLayout>
  );
}
