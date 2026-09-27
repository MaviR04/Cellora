# Running containers

- **Captured:** 2026-09-27T11:32:16.269Z
- **Shows:** Three MongoDB nodes and Redis running and healthy in Docker.
- **Report section:** 4. Solution design: deployment
- **Command:** `docker compose -f infra/docker-compose.yml ps`

```text
NAME      IMAGE       STATUS                   PORTS
mongo1    mongo:7.0   Up 3 minutes (healthy)   0.0.0.0:27017->27017/tcp, [::]:27017->27017/tcp
mongo2    mongo:7.0   Up 3 minutes             0.0.0.0:27018->27018/tcp, [::]:27018->27018/tcp
mongo3    mongo:7.0   Up 3 minutes             0.0.0.0:27019->27019/tcp, [::]:27019->27019/tcp
redis     redis:7.4   Up 3 minutes (healthy)   0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp
```
