"use client";

/**
 * A form's submit button that asks for confirmation before submitting -
 * for destructive actions (leave/delete household) where a mis-click
 * matters. Client Component - `window.confirm` is browser-only.
 *
 * Real logic worth documenting: intercepts the click with
 * `event.preventDefault()` when the user declines the confirm dialog,
 * stopping the form from submitting at all; accepting lets the click
 * proceed as a normal submit.
 * @param label The button's visible text.
 * @param confirmMessage The message shown in the `window.confirm` dialog.
 * @param className Optional CSS classes for the button.
 * @returns A `<button type="submit">` guarded by the confirm dialog.
 */
export function ConfirmButton({
  label,
  confirmMessage,
  className,
}: {
  label: string;
  confirmMessage: string;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}
