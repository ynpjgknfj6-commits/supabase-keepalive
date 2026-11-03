# supabase-keepalive

Keeps the F1 Fantasy Supabase project (`aftqqefagxvhulhfcyhg`) from pausing.

Free Supabase projects pause after 7 days without activity. The workflow in
`.github/workflows/keepalive.yml` runs every 3 days on GitHub's servers and
reads one row from the database. It does not need a laptop.

- **Run it by hand:** Actions → Supabase keepalive → Run workflow.
- **Key:** the public anon key is stored as the repository secret `SUPABASE_ANON_KEY`.
- **If a run fails:** GitHub emails you. Usually it means the project is paused:
  restore it in the Supabase dashboard.
- Each run writes the time to `last-ping.txt`. That commit keeps GitHub from
  disabling the schedule after 60 days without repository activity.
