# Publish and connect bookings

## Supabase setup

1. Create a Supabase project and open its SQL editor.
2. In `supabase/schema.sql`, replace `REPLACE_WITH_FAISAL_OWNER_EMAIL` with Faisal's sign-in email, then run the entire file.
3. Supabase Authentication must allow email sign-in. Add `http://localhost:5173` and the final GitHub Pages URL to the URL Configuration redirect allowlist.
4. In Supabase's SQL editor, set Faisal's local time zone and availability. The initial schedule is India Standard Time, Monday-Friday, 09:00-17:00, 30-minute slots, with two hours' notice.

For an existing project, run `supabase/set-india-timezone.sql` to change only the time zone and keep the configured availability hours.

The full update, if you also want to set weekdays from 09:00 to 17:00, is:

```sql
update public.app_settings
set time_zone = 'Asia/Kolkata',
    opening_time = '09:00',
    closing_time = '17:00',
    opening_days = array[1, 2, 3, 4, 5]::smallint[],
    slot_minutes = 30,
    notice_hours = 2
where id = true;
```

5. Copy `.env.example` to `.env.local` for local testing. Use the Supabase project URL and anon/publishable key. Never put a service-role key in the app.

## GitHub Pages

1. Create a new GitHub repository and push this project to its `main` branch.
2. In the repository, add the variable `SUPABASE_URL` and the secret `SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions**. The anon/publishable key is intended for browser use; database RLS protects the data.
3. Under **Settings → Pages**, set the build and deployment source to **GitHub Actions**.
4. Run the `Deploy to GitHub Pages` workflow, or push to `main`. Add the resulting site URL to Supabase's redirect URL allowlist.
5. Faisal signs in using the exact owner email configured in the schema. Customers use their own email links to book and view their own records.

The public site displays open slots only. The database—not the page—enforces that appointment details can be read only by their customer and the configured owner.