import { config } from "./config";
import { db } from "./store";
import { createApp } from "./server";
import { scheduleBackups } from "./backup";

db(); // applies migrations at boot
scheduleBackups();
createApp().listen(config.port, () => {
  console.log(`[finance] listening on :${config.port}  (data=${config.dataDir}, backups=${config.backupDir})`);
});
