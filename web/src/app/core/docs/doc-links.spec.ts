import { docLocation, mentionedTicketKey, mentionFragment } from './doc-links';

describe('docLocation', () => {
  it('shows the folder path, and the project key only for other projects', () => {
    // Act + Assert
    expect(docLocation('Architecture/ADRs/0001 Use Postgres', 'PAY', 'PAY')).toBe(
      'Architecture / ADRs',
    );
    expect(docLocation('Runbooks/Stripe outage', 'OPS', 'PAY')).toBe('OPS · Runbooks');
    expect(docLocation('Home', 'PAY', 'PAY')).toBe('');
    expect(docLocation('Home', 'OPS', 'PAY')).toBe('OPS');
    expect(docLocation('Q1\\/Q2 plans/Notes', 'PAY', 'PAY')).toBe('Q1/Q2 plans');
  });
});

describe('mention fragments', () => {
  it('round-trip a ticket key and ignore other fragments', () => {
    // Act + Assert
    expect(mentionFragment('PAY-12')).toBe('mention-PAY-12');
    expect(mentionedTicketKey(mentionFragment('PAY-12'))).toBe('PAY-12');
    expect(mentionedTicketKey('overview')).toBeNull();
    expect(mentionedTicketKey('mention-')).toBeNull();
  });
});
