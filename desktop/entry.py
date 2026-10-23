"""Frozen application entry point (never executes user supplied Python scripts)."""
import multiprocessing

if __name__ == '__main__':
    multiprocessing.freeze_support()
    from agent_hub.desktop_app import main
    raise SystemExit(main())
