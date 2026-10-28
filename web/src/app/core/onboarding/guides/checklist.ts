import { GuideRef } from '../onboarding.models';

/// The getting-started card on My work (spec 14.3, D-133). It shows by itself, so it is an auto-shown
/// guide; raising the version shows it again to everyone who dismissed or completed it.
export const CHECKLIST_GUIDE: GuideRef = { id: 'checklist', version: 1 };
