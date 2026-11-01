"""Run the service:  python -m opsmind_intel   (env: DATABASE_URL, INTERNAL_API_KEY, PORT)"""
import os

import uvicorn

from .logging_config import configure_logging

if __name__ == "__main__":
    configure_logging()
    uvicorn.run("opsmind_intel.app:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_config=None)
