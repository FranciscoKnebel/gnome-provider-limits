import type { ReaderStatus } from "../readers/base.js";

export type DisplayStatus = Exclude<ReaderStatus, ReaderStatus.DISABLED>;
