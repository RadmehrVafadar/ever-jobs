import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Modal } from "./ui";

describe("Modal", () => {
  it("moves focus into the dialog and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const opener = screen.getByRole("button", { name: "Open editor" });

    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Edit route" });
    expect(dialog).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes when the backdrop is clicked but not when dialog content is clicked", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Open editor" }));

    await user.click(screen.getByText("Dialog body"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("presentation"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <Modal open={open} title="Edit route" onClose={() => setOpen(false)}>
        <p>Dialog body</p>
      </Modal>
    </>
  );
}
