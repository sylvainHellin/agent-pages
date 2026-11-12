"""agent-pages serve: report pages under the configured roots, the lessons and the library app, from one process.

  app.py      HTTP routes, build() and the `agent-pages serve` command
  reports.py  the report page index and the file:// link rewriting
  library.py  lessons, their metadata and the vault's projects
  jobs.py     link inbox, review sync between devices, agent jobs (runner off until it drives hc)
"""
