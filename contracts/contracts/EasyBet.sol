// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
// import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EasyBet - 去中心化的竞猜与票据交易（ERC721）合约
/// @author GitHub Copilot
/// @notice 合约支持公证人创建竞猜活动（多个选项），玩家下注获得 ERC721 票据，票据可二级交易，公证人结算并按胜出票据均分奖池。
contract EasyBet is ERC721, Ownable, ReentrancyGuard {
    // using Counters for Counters.Counter; // 移除
    uint256 private _tokenIds; // 票据 tokenId 计数器（从 0 开始，铸造前自增）
    uint256 private _activityIds; // 活动 id 计数器（从 0 开始，创建前自增）

    // 记录每张票据的信息
    struct Ticket {
        uint256 activityId; // 哪个活动
        uint256 choiceIndex; // 选择的选项索引
        uint256 amount; // 购买金额（wei）
    }

    // 活动结构体
    struct Activity {
        address creator; // 创建者（公证人），通常是合约 owner
        uint256 deadline; // 截止时间（timestamp），在此之前可下注
        string[] choices; // 选项列表
        uint256 initialPool; // 创建时公证人注入的初始奖池（wei）
        uint256 totalPool; // 当前总奖池（包括玩家下注）
        uint256[] ticketIds; // 参与该活动的所有票据 id（用于结算时遍历）
        bool settled; // 是否已结算
        uint256 winningChoice; // 结算后记录的胜出选项索引
    }

    // 二级市场挂单信息
    struct Listing {
        address seller;
        uint256 price; // in wei
        bool exists;
    }

    // mappings
    mapping(uint256 => Activity) public activities; // activityId => Activity
    mapping(uint256 => Ticket) public tickets; // tokenId => Ticket
    mapping(uint256 => Listing) public listings; // tokenId => Listing

    // 事件

    // 用户下注，生成一张票（NFT）
    event BetPlaced(
        uint256 indexed tokenId, // 新铸造的票据 NFT ID
        uint256 indexed activityId, // 所属活动 ID
        uint256 price, // 下注金额
        address indexed owner // 用户地址
    );

    // 创建新的竞猜活动
    event ActivityCreated(
        uint256 indexed activityId, // 活动 ID
        uint256 initialPool, // 初始奖池金额
        uint256 deadline // 截止下注时间
    );

    // 用户将票上架转售（挂单）
    event TicketListed(
        uint256 indexed tokenId, // 上架的票据 ID
        address indexed seller, // 卖家地址
        uint256 price // 出售价
    );

    // 用户取消票的挂单
    event TicketListingCanceled(
        uint256 indexed tokenId, // 票据 ID
        address indexed seller // 卖家地址
    );

    // 票被二手市场购买
    event TicketSold(
        uint256 indexed tokenId, // 票据 ID
        address indexed seller, // 卖家
        address indexed buyer, // 买家
        uint256 price // 二手出售价格
    );

    // 活动结算
    event ActivitySettled(
        uint256 indexed activityId, // 活动 ID
        uint256 winningChoice, // 获胜选项
        uint256 winnersCount, // 获胜票数
        uint256 totalPool // 最终奖池
    );

    // 将初始 owner 传给 OpenZeppelin v5 的 Ownable 基类
    constructor() ERC721("EasyBetTicket", "EBT") Ownable(msg.sender) {
        // 构造函数，ERC721 名称与简称，Ownable 初始化为部署者
    }

    // ========== 活动管理（仅合约 owner / 公证人） ==========

    /// @notice 创建一个竞猜活动，并注入初始奖池（payable）
    /// @param choices 选项数组，至少两个选项
    /// @param deadline 截止时间（unix timestamp），必须大于当前时间
    function createActivity(
        string[] calldata choices,
        uint256 deadline
    ) external payable onlyOwner returns (uint256) {
        require(choices.length >= 2, "At least two options required");
        require(deadline > block.timestamp, "Deadline must be in the future");
        require(msg.value > 0, "Initial pool must be provided");

        // v5: 原生自增
        _activityIds += 1;
        uint256 newActivityId = _activityIds;

        Activity storage a = activities[newActivityId];
        a.creator = msg.sender;
        a.deadline = deadline;
        for (uint i = 0; i < choices.length; i++) {
            a.choices.push(choices[i]);
        }
        a.initialPool = msg.value;
        a.totalPool = msg.value;
        a.settled = false;

        emit ActivityCreated(newActivityId, msg.value, deadline);
        return newActivityId;
    }

    /// @notice 公证人可向已有活动追加资金
    function fundActivity(uint256 activityId) external payable onlyOwner {
        require(activityExists(activityId), "Activity does not exist");
        require(!activities[activityId].settled, "Activity already settled");
        require(msg.value > 0, "Amount must be greater than 0");
        activities[activityId].totalPool += msg.value;
    }

    // ========== 下注与票据铸造 ==========

    /// @notice 玩家下注，支付 ETH 获得一张 ERC721 票据
    /// @param activityId 要下注的活动 id
    /// @param choiceIndex 选择的选项索引
    function buyTicket(
        uint256 activityId,
        uint256 choiceIndex
    ) external payable returns (uint256) {
        require(activityExists(activityId), "Activity does not exist");
        Activity storage a = activities[activityId];
        require(block.timestamp < a.deadline, "Activity has ended");
        require(choiceIndex < a.choices.length, "Invalid choice index");
        require(msg.value > 0, "Bet amount must be greater than 0");

        // mint a new ticket
        _tokenIds += 1;
        uint256 newTokenId = _tokenIds;
        _safeMint(msg.sender, newTokenId);

        // 保存票据信息并加入活动票据列表
        tickets[newTokenId] = Ticket({
            activityId: activityId,
            choiceIndex: choiceIndex,
            amount: msg.value
        });
        a.ticketIds.push(newTokenId);
        a.totalPool += msg.value;

        emit BetPlaced(newTokenId, activityId, msg.value, msg.sender);
        return newTokenId;
    }

    // ========== 二級市場（持票人掛單 -> 其他人購買） ==========

    /// @notice 持票人将票据挂单出售。注意：需要先 approve 给本合约（approve(tokenId) 或 setApprovalForAll）
    /// @param tokenId 要挂单的票据 id
    /// @param price 挂单价格（wei）
    function listTicket(uint256 tokenId, uint256 price) external {
        require(ownerOf(tokenId) == msg.sender, "Not the ticket owner");
        require(price > 0, "Price must be greater than 0");
        // 合约需要被批准可以转移该 token
        require(
            _isApprovedOrOwnerForListing(tokenId, msg.sender),
            "Please approve contract to transfer ticket"
        );

        listings[tokenId] = Listing({
            seller: msg.sender,
            price: price,
            exists: true
        });
        emit TicketListed(tokenId, msg.sender, price);
    }

    /// @notice 持票人取消挂单
    function cancelListing(uint256 tokenId) external {
        Listing storage l = listings[tokenId];
        require(l.exists, "No listing");
        require(l.seller == msg.sender, "Only seller can cancel");
        delete listings[tokenId];
        emit TicketListingCanceled(tokenId, msg.sender);
    }

    /// @notice 購買掛單票據（支付 exact price），合約會將款項轉給賣家並將票據轉移給買家
    function buyListedTicket(uint256 tokenId) external payable nonReentrant {
        Listing storage l = listings[tokenId];
        require(l.exists, "No listing");
        require(msg.value == l.price, "Payment must equal listing price");

        address seller = l.seller;
        address buyer = msg.sender;
        uint256 price = l.price;

        // 删除挂单（避免重入期间重复使用）
        delete listings[tokenId];

        // 执行票据转移：合约已被卖家批准，所以可以从卖家转出到买家
        _safeTransfer(seller, buyer, tokenId, "");

        // 将款项转给卖家（若失败则 revert）
        (bool sent, ) = payable(seller).call{value: price}("");
        require(sent, "Transfer to seller failed");

        emit TicketSold(tokenId, seller, buyer, price);
    }

    // ========== 结算 ==========

    /// @notice 合约 owner（公证人）结算活动，输入胜出选项索引。结算时按当前持有胜出票据的持有人均分 totalPool。
    /// @dev 遍历活动票据数组，gas 随票据数增长，请谨慎使用
    function settleActivity(
        uint256 activityId,
        uint256 winningChoice
    ) external onlyOwner nonReentrant {
        require(activityExists(activityId), "Activity does not exist");
        Activity storage a = activities[activityId];
        require(!a.settled, "Activity already settled");
        require(winningChoice < a.choices.length, "Invalid winning choice");

        a.settled = true;
        a.winningChoice = winningChoice;

        // 统计胜出票据数（按当前持有人）
        uint256 winnersCount = 0;
        for (uint i = 0; i < a.ticketIds.length; i++) {
            uint256 tid = a.ticketIds[i];
            if (tickets[tid].choiceIndex == winningChoice) {
                address holder = ownerOf(tid);
                // 仅计数仍存在的持有人（ownerOf 不会 revert，因为 token 已存在）
                if (holder != address(0)) {
                    winnersCount++;
                }
            }
        }

        if (winnersCount == 0) {
            // 若无人胜出，资金仍保留在合约中（可由公证人另行处理或留作平台基金）
            emit ActivitySettled(activityId, winningChoice, 0, a.totalPool);
            return;
        }

        uint256 share = a.totalPool / winnersCount;
        // 向每个胜出票据当前持有人支付份额
        for (uint i = 0; i < a.ticketIds.length; i++) {
            uint256 tid = a.ticketIds[i];
            if (tickets[tid].choiceIndex == winningChoice) {
                address payable holder = payable(ownerOf(tid));
                // 若发送失败，这里会 revert，从而保证所有赢家都能收到款项或回滚（能保证一致性）
                (bool ok, ) = holder.call{value: share}("");
                require(ok, "Failed to send prize to winner");
            }
        }

        emit ActivitySettled(
            activityId,
            winningChoice,
            winnersCount,
            a.totalPool
        );
    }

    // ========== 只读辅助（补充便于前端使用的接口） ==========

    function activityExists(uint256 activityId) public view returns (bool) {
        return activityId > 0 && activityId <= _activityIds;
    }

    /// @notice 返回最新创建的 activityId（便于前端在事件缺失时查询）
    function getLatestActivityId() external view returns (uint256) {
        return _activityIds;
    }

    function getChoicesCount(
        uint256 activityId
    ) external view returns (uint256) {
        require(activityExists(activityId), "Activity does not exist");
        return activities[activityId].choices.length;
    }

    /// @notice 查看某活动所有票据 id（注意数组可能较大）
    function getActivityTicketIds(
        uint256 activityId
    ) external view returns (uint256[] memory) {
        require(activityExists(activityId), "Activity does not exist");
        return activities[activityId].ticketIds;
    }

    /// @notice 查看票据详细信息
    function getTicketInfo(
        uint256 tokenId
    )
        external
        view
        returns (uint256 activityId, uint256 choiceIndex, uint256 amount)
    {
        // 不调用 _exists，改为使用 tickets 映射判断票据是否存在（amount != 0）
        require(tickets[tokenId].amount != 0, "Ticket does not exist");
        Ticket storage t = tickets[tokenId];
        return (t.activityId, t.choiceIndex, t.amount);
    }

    /// @notice 查看挂单信息
    function getListing(
        uint256 tokenId
    ) external view returns (address seller, uint256 price, bool exists) {
        Listing storage l = listings[tokenId];
        return (l.seller, l.price, l.exists);
    }

    // ========== 内部与辅助函数 ==========

    /// @notice 检查卖家是否已经给合约批准用于转移 tokenId（要么单个 approve，要么 setApprovalForAll）
    function _isApprovedOrOwnerForListing(
        uint256 tokenId,
        address seller
    ) internal view returns (bool) {
        address approved = getApproved(tokenId);
        if (approved == address(this)) return true;
        if (isApprovedForAll(seller, address(this))) return true;
        return false;
    }

    // ========== 紧急取款（仅 owner） ==========
    /// @notice 若合约内有遗留资金，合约 owner 可取回（谨慎使用）
    function withdraw(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "Exceeds contract balance");
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Withdraw failed");
    }

    // fallback / receive：合约可以接收 ETH（如结算后剩余的分配余数）
    receive() external payable {}
}
