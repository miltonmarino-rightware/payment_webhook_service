import { Router } from "express";

const router = Router();

router.post("/payment_intents", async (_req, res) => {
  res.status(501).json({
    error: "not_implemented",
    message: "Payment Intent creation will be implemented after database schema is finalized.",
  });
});

router.get("/payment_intents/:id", async (req, res) => {
  res.status(501).json({
    error: "not_implemented",
    id: req.params.id,
  });
});

router.post("/payment_intents/:id/confirm", async (req, res) => {
  res.status(501).json({
    error: "not_implemented",
    id: req.params.id,
  });
});

export default router;
