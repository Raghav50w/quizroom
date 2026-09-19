"""Hand-labelled retrieval queries, one list per PDF.

Each entry is (query, fingerprint):

  query        what a user would type in the focus box
  fingerprint  a phrase that appears in the passage answering it, and ideally
               nowhere else. A retrieval hit means a returned chunk contains it.

The fingerprint is a marker, not an answer. It only has to identify the right
chunk under a substring match, so it is copied verbatim from the document.
Some queries deliberately use different wording from the fingerprint ("how
quickly is compute demand doubling" rather than the document's "AI compute
power growing") — those are the queries where a lexical baseline and an
embedding model can disagree.

The PDFs themselves are gitignored (they are not ours to republish). Keyed by
filename; eval.py skips any PDF in the folder that has no entry here.
"""

from __future__ import annotations

QUERIES: dict[str, list[tuple[str, str]]] = {
    # IEEE two-column review paper, 30 pages. arXiv / IEEE Open Journal of Power Electronics.
    "State-of-the-Art_Power_Electronics_in_AI_Data_Centers.pdf": [
        ("how fast is AI compute power growing", "3.4 months"),
        ("how quickly is compute demand doubling", "3.4 months"),
        ("solid-state transformers connecting to the utility grid", "solid-state transformers"),
        ("temperature of PFC stage components under full load", "PFC HF leg"),
        ("rack power where PSU-based distribution becomes impractical", "200 kW rack loads"),
        ("using 650 V GaN devices on the primary side", "half of the total bus voltage"),
        ("peak efficiency of LLC converters around 1.2 to 1.6 kW", "98.3% Pk"),
        ("advantages of matrix transformer design", "matrix transformer"),
        ("output voltage and current range of voltage regulator modules", "0.6-1.8 V"),
        ("how the trans-inductor voltage regulator works", "IP-TLVR combines"),
        ("transient recovery time of multiphase buck converters", "50 µs"),
        ("highest reported power density at 1 MHz", "3500 W/in3"),
        ("two-stage resonant switched-capacitor converter structure", "2:1 resonant SC front end"),
        ("why GaN devices have low on-resistance", "two-dimensional electron gas"),
        ("price range of SiC MOSFETs", "$5 to over $130"),
        ("limits on scaling conventional AC power supply units", "copper usage"),
    ],
    # Silberschatz, Galvin, Gagne — Operating System Concepts, chapter 3 (Processes), textbook prose.
    "OS_test.pdf": [
        ("what is a process", "unit of work in a modern computing system"),
        ("what states can a process be in", "waiting to be assigned to a processor"),
        ("Linux structure that stores a process's information", "task_struct"),
        ("how the OS controls how many programs are loaded in memory", "degree of multiprogramming"),
        ("why switching between processes wastes CPU time", "pure overhead"),
        ("what does fork return to the child and the parent", "zero for the new (child) process"),
        ("replacing a process's memory image with a new program", "execlp"),
        ("how Windows creates a new process", "CreateProcess"),
        ("killing all descendants when a parent exits", "cascading termination"),
        ("process that finished but whose parent never called wait", "zombie"),
        ("what happens to children when their parent dies first", "init process periodically invokes wait"),
        ("how the Chrome browser isolates web pages from each other", "sandbox"),
        ("producer consumer with a fixed size buffer", "circular array"),
        ("two processes sharing a region of memory", "attach it to their address space"),
        ("what is a rendezvous in message passing", "rendezvous"),
        ("POSIX shared memory API", "shm unlink"),
        ("how Mach controls who can receive from a port", "port rights"),
        ("Windows local RPC mechanism", "ALPC"),
        ("difference between anonymous and named pipes", "named pipes continue to exist"),
        ("special IP address that refers to the local machine", "loopback"),
        ("making sure a remote call runs only one time", "exactly once"),
        ("how RPC handles different byte orderings across machines", "external data representation"),
        ("how a client finds which port a remote service listens on", "matchmaker"),
        ("Android mechanism for calling into a service in another app", "binder"),
    ],
    # Lecture slides for the same chapter, exported to PDF. Bullet points, sparse.
    "oschap.pdf": [
        ("what is a process", "program in execution"),
        ("process states", "waiting for some event to occur"),
        ("what does the PCB contain", "task control block"),
        ("queues used by the process scheduler", "Device queues"),
        ("difference between long term and short term scheduler", "invoked infrequently"),
        ("how iOS limits background apps", "Single foreground process"),
        ("cost of switching between processes", "does no useful work while switching"),
        ("how a parent creates and waits for a child", "pid = wait(&status)"),
        ("zombie and orphan processes", "did not invoke wait"),
        ("Chrome multiprocess design", "Renderer process"),
        ("bounded buffer producer consumer", "BUFFER_SIZE-1"),
        ("mailboxes for indirect communication", "also referred to as ports"),
        ("blocking versus non-blocking send", "rendezvous"),
        ("reasons processes cooperate", "Computation speedup"),
    ],
    # Single-column analytics report, 8 pages, author's own.
    "Groww_Assignment.pdf": [
        ("how many users never started KYC", "4,366 users"),
        ("typical demographics of signups", "median age 28"),
        ("what fraction of users actually invest", "11.8%"),
        ("which product makes the most money", "74% of brokerage"),
        ("using the linked bank as a proxy for income", "Axis customers invest at 40%"),
        ("do experienced investors convert better", "20.9% of experienced users"),
        ("data dictionary field that is mislabelled", "kra_not_checked"),
        ("how concentrated is revenue", "top 1% of users produce 90%"),
        ("F&O orders rejected for insufficient funds", "Margin Exceeds"),
        ("definition of tier 1 and tier 2 users", "Tier 2: multi-product regulars"),
        ("does using more products predict high value", "78% with four"),
        ("first week signals that predict value", "Any F&O / commodity order"),
        ("users a seven day watchlist misses", "107 of 149"),
        ("biggest onboarding drop off", "Six in ten users never do it"),
        ("effect of DigiLocker on completion", "DigiLocker"),
        ("actual order of onboarding steps", "Signup, Bank, E-sign/AOF, Selfie"),
    ],
}
