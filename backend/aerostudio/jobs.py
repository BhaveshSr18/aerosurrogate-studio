"""In-process job manager for long-running work (optimization).

Jobs run on a bounded thread pool; each keeps an append-only event log that SSE
clients replay from any offset, so a reconnecting browser misses nothing. The
interface (submit / events / cancel) is what a Redis-backed queue with a separate
GPU worker will implement later; the API layer does not change.
"""

from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

JOB_TTL_S = 3600


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | error | cancelled
    events: list[tuple[str, Any]] = field(default_factory=list)
    created: float = field(default_factory=time.time)
    cancel_flag: threading.Event = field(default_factory=threading.Event)
    _cond: threading.Condition = field(default_factory=threading.Condition)

    def emit(self, event: str, data: Any) -> None:
        with self._cond:
            self.events.append((event, data))
            self._cond.notify_all()

    def wait_events(self, offset: int, timeout: float) -> list[tuple[str, Any]]:
        with self._cond:
            if len(self.events) <= offset and self.status in ("queued", "running"):
                self._cond.wait(timeout)
            return self.events[offset:]

    @property
    def finished(self) -> bool:
        return self.status in ("done", "error", "cancelled")


class JobManager:
    def __init__(self, max_workers: int = 1):
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, kind: str, fn: Callable[[Job], Any]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind)
        with self._lock:
            self._gc()
            self._jobs[job.id] = job

        def runner():
            if job.cancel_flag.is_set():
                job.status = "cancelled"
                job.emit("cancelled", {})
                return
            job.status = "running"
            try:
                result = fn(job)
                if job.cancel_flag.is_set():
                    job.status = "cancelled"
                    job.emit("cancelled", {})
                else:
                    job.status = "done"
                    job.emit("done", result)
            except Exception as e:  # noqa: BLE001 - reported to the client
                if job.cancel_flag.is_set():
                    job.status = "cancelled"
                    job.emit("cancelled", {})
                else:
                    job.status = "error"
                    job.emit("error", {"message": str(e) or type(e).__name__})

        self._pool.submit(runner)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if job is None:
            return False
        job.cancel_flag.set()
        with job._cond:
            job._cond.notify_all()
        return True

    def _gc(self) -> None:
        now = time.time()
        for jid in [j.id for j in self._jobs.values() if j.finished and now - j.created > JOB_TTL_S]:
            self._jobs.pop(jid, None)
