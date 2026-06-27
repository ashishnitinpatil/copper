import { Navigate } from 'react-router-dom';
import { useAppSettings } from './AppSettingsProvider';

export function WelcomeGate({ children }: { children: React.ReactNode }) {
  const { onboarded } = useAppSettings();
  if (onboarded) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
