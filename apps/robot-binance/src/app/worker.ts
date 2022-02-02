import { expose } from "threads/worker";
import { worker } from "@cryptuoso/robot-thread";

expose(worker);
