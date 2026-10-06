import { Navigate, useParams } from 'react-router-dom';
import { useAppSettings } from './AppSettingsProvider';
import { stashInvite } from '@/sync/invite';

// Landing point for an invite link (`/join/<bookId>`): remember the book, then
// continue where joining happens for this device.
export function JoinRoute() {
  const { bookId } = useParams();
  const { onboarded } = useAppSettings();
  if (bookId) stashInvite(bookId);
  return <Navigate to={onboarded ? '/settings' : '/welcome'} replace />;
}
