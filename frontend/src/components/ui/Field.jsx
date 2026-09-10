import { useId } from "react";

// Form controls. Every input is wired to its label and to its hint/error
// through aria-describedby, so the error a sighted user sees under the field
// is the same one a screen reader announces when focus lands.

export function Field({ label, hint, error, htmlFor, children, className = "" }) {
  return (
    <div className={`field ${className}`.trim()}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

/** Text/number/date/email input wrapped in its Field. */
export function Input({
  label,
  hint,
  error,
  id,
  className = "",
  fieldClassName,
  ...rest
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = hint || error ? `${inputId}-desc` : undefined;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      className={fieldClassName}
      hint={hint && <span id={describedBy}>{hint}</span>}
      error={error && <span id={describedBy}>{error}</span>}
    >
      <input
        id={inputId}
        className={`input ${className}`.trim()}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
    </Field>
  );
}

/** Dollar input: the unit lives inside the control, next to the digits. */
export function MoneyInput({ label, hint, error, id, ...rest }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error}>
      <span className="input-affix">
        <span className="input-affix-symbol" aria-hidden="true">
          $
        </span>
        <input
          id={inputId}
          type="number"
          step="0.01"
          inputMode="decimal"
          className="input u-num"
          aria-invalid={error ? "true" : undefined}
          {...rest}
        />
      </span>
    </Field>
  );
}

export function Select({ label, hint, error, id, options, className = "", ...rest }) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <Field label={label} htmlFor={selectId} hint={hint} error={error}>
      <select id={selectId} className={`select ${className}`.trim()} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** A checkbox row: control, primary label, and a right-aligned figure. */
export function CheckRow({ checked, onChange, children, meta }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="check-row-main">{children}</span>
      {meta && <span className="check-row-meta">{meta}</span>}
    </label>
  );
}
