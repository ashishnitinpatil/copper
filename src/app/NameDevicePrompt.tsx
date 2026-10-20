import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useDB } from '@/db/DBProvider';
import { useAuth } from '@/auth/AuthProvider';
import { useSync } from '@/sync/SyncProvider';
import { defaultDeviceName, getLocalDeviceName, setLocalDeviceName } from '@/db/changeLog';

const DISMISS_KEY = 'copper-name-device-dismissed';

/** "phone", "tablet" or "laptop", from what the browser says it runs on. */
function deviceKind(): string {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/iPhone|Android|Mobile/i.test(ua)) return 'phone';
  return 'laptop';
}

/**
 * Once this device shares a book with others, its changes are labelled with
 * its name in everyone's Activity — and the automatic "Device-5D21" means
 * nothing to anyone. Ask for a real name (with a suggestion) until it has one
 * or the person says not now. Most often seen right after joining a book.
 */
export function NameDevicePrompt() {
  const db = useDB();
  const { google } = useAuth();
  const sync = useSync();
  const [current, setCurrent] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const firstName = google?.identity.name?.split(' ')[0];
  const suggestion = firstName ? `${firstName}'s ${deviceKind()}` : `My ${deviceKind()}`;

  useEffect(() => {
    void getLocalDeviceName(db).then(setCurrent);
  }, [db]);

  const save = useCallback(async () => {
    await setLocalDeviceName(db, name || suggestion);
    setCurrent(await getLocalDeviceName(db));
  }, [db, name, suggestion]);

  const shared = !!sync.bookId && sync.peers.length > 0;
  if (dismissed || !shared || current === null || current !== defaultDeviceName(db.siteid)) return null;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-200">Name this device</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Changes you make here show up in Activity as “{current}” on every device in your book. A
            name makes it clear who changed what. You can change it any time in Settings.
          </p>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input
              aria-label="Device name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestion}
              maxLength={40}
              className="min-w-0 flex-1 sm:max-w-xs"
            />
            <Button type="submit" size="sm">
              {name.trim() ? 'Save' : `Use “${suggestion}”`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  localStorage.setItem(DISMISS_KEY, '1');
                } catch {
                  /* still hide it for now */
                }
                setDismissed(true);
              }}
            >
              Not now
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}
