import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import type { Api } from "../src/api.ts";

// a token that is valid for an hour (the app only reads its expiry)
const token = `h.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.s`;

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    session: async () => ({ token, userId: "u1" }),
    sale: async () => ({ open: true, startsAt: null, serverTime: new Date().toISOString() }),
    checkout: async () => ({ kind: "accepted", orderId: "order-1" }),
    orderStatus: async () => "confirmed",
    ...overrides,
  };
}

const fast = { options: { wait: async () => {} } }; // no real waiting in tests
const button = () => screen.getByRole("button");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the shop screen", () => {
  it("shows a countdown and a locked button before the sale starts", async () => {
    const startsAt = new Date(Date.now() + 60_000).toISOString();
    render(<App api={fakeApi({ sale: async () => ({ open: false, startsAt, serverTime: new Date().toISOString() }) })} {...fast} />);

    expect(await screen.findByLabelText("Time until the sale starts")).toHaveTextContent(/^00:0[01]:\d\d$/);
    expect(button()).toBeDisabled();
  });

  it("lets the visitor buy once the sale is open and confirms the order", async () => {
    render(<App api={fakeApi()} {...fast} />);

    await waitFor(() => expect(button()).toBeEnabled());
    await userEvent.click(button());

    expect(await screen.findByText(/Your phone is yours/)).toBeInTheDocument();
    expect(screen.getByText("Order order-1")).toBeInTheDocument();
  });

  it("sends only one purchase however many times the button is clicked", async () => {
    const checkout = vi.fn(async () => ({ kind: "accepted", orderId: "order-1" }) as const);
    render(<App api={fakeApi({ checkout })} {...fast} />);
    await waitFor(() => expect(button()).toBeEnabled());

    await userEvent.tripleClick(button());
    await screen.findByText(/Your phone is yours/);

    expect(checkout).toHaveBeenCalledTimes(1);
  });

  it("tells the visitor when everything is sold out", async () => {
    render(<App api={fakeApi({ checkout: async () => ({ kind: "soldOut" }) })} {...fast} />);
    await waitFor(() => expect(button()).toBeEnabled());

    await userEvent.click(button());

    expect(await screen.findByText(/Sold out/)).toBeInTheDocument();
    expect(button()).toBeDisabled();
  });

  it("tries again by itself when the shop is busy", async () => {
    const answers = [{ kind: "retry" }, { kind: "retry" }, { kind: "accepted", orderId: "order-1" }] as const;
    const checkout = vi.fn(async () => answers[Math.min(checkout.mock.calls.length - 1, 2)]!);
    render(<App api={fakeApi({ checkout })} {...fast} />);
    await waitFor(() => expect(button()).toBeEnabled());

    await userEvent.click(button());

    expect(await screen.findByText(/Your phone is yours/)).toBeInTheDocument();
    expect(checkout).toHaveBeenCalledTimes(3);
  });

  it("gives the button back, with a message, if the shop stays busy", async () => {
    render(<App api={fakeApi({ checkout: async () => ({ kind: "retry" }) })} options={{ wait: async () => {}, maxBuyAttempts: 3 }} />);
    await waitFor(() => expect(button()).toBeEnabled());

    await userEvent.click(button());

    expect(await screen.findByText(/Still busy/)).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it("keeps asking until the order is decided", async () => {
    const answers = ["processing", "processing", "confirmed"] as const;
    const orderStatus = vi.fn(async () => answers[Math.min(orderStatus.mock.calls.length - 1, 2)]!);
    render(<App api={fakeApi({ orderStatus })} {...fast} />);
    await waitFor(() => expect(button()).toBeEnabled());

    await userEvent.click(button());

    expect(await screen.findByText(/Your phone is yours/)).toBeInTheDocument();
    expect(orderStatus).toHaveBeenCalledTimes(3);
  });

  it("shows the earlier order after a page refresh instead of the shop", async () => {
    localStorage.setItem("flash.order", "order-9");

    render(<App api={fakeApi()} {...fast} />);

    expect(await screen.findByText(/Your phone is yours/)).toBeInTheDocument();
    expect(screen.getByText("Order order-9")).toBeInTheDocument();
  });

  it("keeps the same visitor across refreshes", async () => {
    const session = vi.fn(async () => ({ token, userId: "u1" }));
    const { unmount } = render(<App api={fakeApi({ session })} {...fast} />);
    await waitFor(() => expect(button()).toBeEnabled());
    unmount();

    render(<App api={fakeApi({ session })} {...fast} />);
    await waitFor(() => expect(button()).toBeEnabled());

    expect(session).toHaveBeenCalledTimes(1);
  });
});
