import { useAuth } from './AuthProvider';

// "Stay signed in" choice: a trusted device keeps its Google session across
// browser restarts (localStorage); otherwise it's forgotten when the tab closes.
export function TrustDeviceToggle() {
  const auth = useAuth();
  return (
    <label className="flex items-start gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
        checked={auth.trustDevice}
        onChange={(e) => auth.setTrustDevice(e.target.checked)}
      />
      <span className="text-xs text-slate-400">
        <span className="font-medium text-slate-300">Trust this device (stay signed in)</span>
        <br />
        Keeps you connected across browser restarts. On a shared or public computer, leave
        this off — your sign-in is then forgotten when you close the tab.
      </span>
    </label>
  );
}
