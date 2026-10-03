import type { UserFormProfile } from './user-profile';

// Controlled guard fixture: an administrator keeps reusable personal form details.
// This repo has no generated users.user_form_profile Row contract. Keep every
// field in the canonical runtime profile schema present, including nullable ones.
export const profileFixture = {
  legal_first_name: null,
  legal_middle_name: null,
  legal_last_name: null,
  preferred_name: 'Maya',
  name_suffix: null,
  pronouns: null,
  date_of_birth: null,
  phones: [],
  emails: [],
  social_handles: [],
  website_url: null,
  shipping_line1: null,
  shipping_line2: null,
  shipping_city: null,
  shipping_region: null,
  shipping_postal_code: null,
  shipping_country: null,
  billing_same_as_shipping: true,
  billing_line1: null,
  billing_line2: null,
  billing_city: null,
  billing_region: null,
  billing_postal_code: null,
  billing_country: null,
  company_name: null,
  job_title: null,
  emergency_contacts: [],
  custom_fields: {},
} satisfies Required<UserFormProfile>;
