// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

// Uncomment the line to use openzeppelin/ERC721,ERC20
// You can use this dependency directly because it has been installed by TA already
// import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
// import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract EasyBet {

    // use a event if you want
    // to represent time you can choose block.timestamp
    event BetPlaced(uint256 tokenId, uint256 price, address owner);

    // maybe you need a struct to store some activity information
    struct Activity {
        address owner;
        uint256 listedTimestamp;
        string[] choices;
        // ...
    }

    mapping(uint256 => Activity) public activities; // A map from activity-index to its information
    // ...
    // TODO add any variables and functions if you want

    constructor() {
        // maybe you need a constructor
    }

    function helloworld() pure external returns(string memory) {
        return "hello world";
    }

    // ...
    // TODO add any logic if you want
}