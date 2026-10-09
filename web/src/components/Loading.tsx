import "./Loading.css";

/** Skeleton shimmer block. */
export function Skeleton({
  width = "100%",
  height = 16,
  rounded = 8,
}: {
  width?: string | number;
  height?: string | number;
  rounded?: number;
}) {
  return (
    <div
      className="eko-skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: rounded }}
    />
  );
}

/** Full-area loading state with staged message + slow-network notice. */
export function Loading({
  message = "Loading…",
  slow = false,
}: {
  message?: string;
  slow?: boolean;
}) {
  return (
    <div className="eko-loading" role="status" aria-live="polite">
      <div className="eko-loading__spinner" aria-hidden="true" />
      <p className="eko-loading__message">{message}</p>
      {slow && (
        <p className="eko-loading__slow">
          Slow network… the city is still loading, hang tight.
        </p>
      )}
    </div>
  );
}
