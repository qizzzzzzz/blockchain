import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Test", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    const EasyBet = await ethers.getContractFactory("EasyBet");
    const easyBet = await EasyBet.deploy();

    return { easyBet: easyBet, owner, otherAccount };
  }

  describe("Deployment", function () {
    it("Should return hello world", async function () {
      const { easyBet } = await loadFixture(deployFixture);
      expect(await easyBet.helloworld()).to.equal("hello world");
    });
  });
});