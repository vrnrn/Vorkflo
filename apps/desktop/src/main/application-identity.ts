export const DESKTOP_APPLICATION_NAME = 'Vorkflo';

export interface ApplicationIdentityTarget {
  setName(name: string): void;
}

export function applyApplicationIdentity(
  application: ApplicationIdentityTarget,
): void {
  application.setName(DESKTOP_APPLICATION_NAME);
}
